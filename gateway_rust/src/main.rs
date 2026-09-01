use std::error::Error;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use clap::Parser;
use ringbuf::traits::Split;
use ringbuf::HeapRb;
use tracing::{info, warn};

mod bridge;
mod capture;
mod playback;

/// Jarvis Audio Gateway — Zero-GC, microsecond-latency Linux audio engine.
///
/// Captures microphone audio (16kHz mono PCM) and plays back response audio (24kHz mono PCM)
/// with low-latency Unix Domain Socket streaming directly to the Python Core Engine.
#[derive(Parser, Debug)]
#[command(name = "jarvis-gateway", version, about)]
struct Args {
    /// Unix domain socket path for high-performance zero-network IPC
    #[arg(long, default_value = "/tmp/jarvis_audio.sock")]
    socket_path: String,

    /// Use TCP bridge instead of Unix domain socket
    #[arg(long, default_value_t = false)]
    use_tcp: bool,

    /// Orchestrator host address (when using TCP)
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// Orchestrator TCP port (when using TCP)
    #[arg(long, default_value_t = 3001)]
    port: u16,

    /// Microphone capture sample rate in Hz
    #[arg(long, default_value_t = 16000)]
    capture_rate: u32,

    /// Speaker playback sample rate in Hz
    #[arg(long, default_value_t = 24000)]
    playback_rate: u32,

    /// Ring buffer capacity in bytes (default ~1 second of 16kHz i16 mono)
    #[arg(long, default_value_t = 64000)]
    buffer_size: usize,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize structured logging (controlled by RUST_LOG env var)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .compact()
        .init();

    let args = Args::parse();

    info!("========================================");
    info!("  J.A.R.V.I.S. Audio Gateway v{}", env!("CARGO_PKG_VERSION"));
    info!("========================================");

    let target = if args.use_tcp {
        let addr = format!("{}:{}", args.host, args.port);
        info!("Audio Bridge Target: TCP -> {}", addr);
        bridge::BridgeTarget::Tcp(addr)
    } else {
        info!("Audio Bridge Target: Unix Domain Socket -> {}", args.socket_path);
        bridge::BridgeTarget::UnixSocket(args.socket_path)
    };

    info!(
        "Capture: {}Hz mono i16 | Playback: {}Hz mono i16",
        args.capture_rate, args.playback_rate
    );
    info!("Ring buffer: {} bytes per channel", args.buffer_size);

    // Shared shutdown flag
    let shutdown = Arc::new(AtomicBool::new(false));

    // --- Ring Buffers ---
    let capture_rb = HeapRb::<u8>::new(args.buffer_size);
    let (capture_prod, capture_cons) = capture_rb.split();

    let playback_rb = HeapRb::<u8>::new(args.buffer_size * 2); // larger for 24kHz
    let (playback_prod, playback_cons) = playback_rb.split();

    // --- Spawn Capture Thread ---
    let capture_rate = args.capture_rate;
    let capture_shutdown = Arc::clone(&shutdown);
    let capture_handle = std::thread::Builder::new()
        .name("jarvis-capture".into())
        .spawn(move || {
            if let Err(e) = capture::run(capture_prod, capture_rate, capture_shutdown) {
                warn!("Capture thread exited with error: {}", e);
            }
        })?;

    // --- Spawn Playback Thread ---
    let playback_rate = args.playback_rate;
    let playback_shutdown = Arc::clone(&shutdown);
    let playback_handle = std::thread::Builder::new()
        .name("jarvis-playback".into())
        .spawn(move || {
            if let Err(e) = playback::run(playback_cons, playback_rate, playback_shutdown) {
                warn!("Playback thread exited with error: {}", e);
            }
        })?;

    // --- Spawn Audio Bridge Task ---
    let bridge_shutdown = Arc::clone(&shutdown);
    let bridge_handle = tokio::spawn(async move {
        bridge::run(capture_cons, playback_prod, target, bridge_shutdown).await;
    });

    // --- Wait for Ctrl+C ---
    info!("Gateway running. Press Ctrl+C to shutdown.");
    tokio::signal::ctrl_c().await?;

    info!("Shutdown signal received. Stopping...");
    shutdown.store(true, Ordering::SeqCst);

    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    bridge_handle.abort();
    let _ = bridge_handle.await;

    capture_handle.thread().unpark();
    playback_handle.thread().unpark();

    let _ = capture_handle.join();
    let _ = playback_handle.join();

    info!("J.A.R.V.I.S. Audio Gateway shut down cleanly.");
    Ok(())
}
