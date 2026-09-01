use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ringbuf::traits::{Consumer, Producer};
use ringbuf::{HeapCons, HeapProd};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpStream, UnixStream};
use tokio::time::{self, Duration};
use tracing::{error, info, warn};

/// Maximum backoff delay between reconnection attempts (30 seconds).
const MAX_BACKOFF_SECS: u64 = 30;

/// Initial backoff delay (1 second).
const INITIAL_BACKOFF_SECS: u64 = 1;

/// Interval between send cycles (20ms = ~320 samples at 16kHz = 640 bytes).
const SEND_INTERVAL_MS: u64 = 20;

/// Maximum frame size to send in one write (32KB).
const MAX_FRAME_BYTES: usize = 32768;

#[derive(Clone, Debug)]
pub enum BridgeTarget {
    UnixSocket(String),
    Tcp(String),
}

/// Runs the Audio Bridge on tokio runtime with support for Unix Domain Sockets and TCP.
pub async fn run(
    capture_cons: HeapCons<u8>,
    playback_prod: HeapProd<u8>,
    target: BridgeTarget,
    shutdown: Arc<AtomicBool>,
) {
    let mut backoff_secs = INITIAL_BACKOFF_SECS;

    let capture_cons = Arc::new(tokio::sync::Mutex::new(capture_cons));
    let playback_prod = Arc::new(tokio::sync::Mutex::new(playback_prod));

    loop {
        if shutdown.load(Ordering::Relaxed) {
            info!("[Bridge] Shutdown flag set, exiting bridge loop");
            return;
        }

        match &target {
            BridgeTarget::UnixSocket(path) => {
                info!("[Bridge] Connecting to Unix Domain Socket: {}", path);
                match UnixStream::connect(Path::new(path)).await {
                    Ok(stream) => {
                        info!("[Bridge] Connected to Python Core Engine via Unix Socket: {}", path);
                        backoff_secs = INITIAL_BACKOFF_SECS;
                        let (read_half, write_half) = stream.into_split();
                        run_stream_io(read_half, write_half, &capture_cons, &playback_prod, &shutdown).await;
                        warn!("[Bridge] Unix socket connection closed, will reconnect...");
                    }
                    Err(e) => {
                        warn!("[Bridge] Failed to connect to Unix socket {}: {}. Retrying in {}s...", path, e, backoff_secs);
                    }
                }
            }
            BridgeTarget::Tcp(addr) => {
                info!("[Bridge] Connecting to TCP: {}", addr);
                match TcpStream::connect(addr).await {
                    Ok(stream) => {
                        info!("[Bridge] Connected to orchestrator via TCP at {}", addr);
                        backoff_secs = INITIAL_BACKOFF_SECS;
                        if let Err(e) = stream.set_nodelay(true) {
                            warn!("[Bridge] Failed to set TCP_NODELAY: {}", e);
                        }
                        let (read_half, write_half) = stream.into_split();
                        run_stream_io(read_half, write_half, &capture_cons, &playback_prod, &shutdown).await;
                        warn!("[Bridge] TCP connection closed, will reconnect...");
                    }
                    Err(e) => {
                        warn!("[Bridge] Failed to connect to TCP {}: {}. Retrying in {}s...", addr, e, backoff_secs);
                    }
                }
            }
        }

        // Wait before reconnecting
        let sleep_duration = Duration::from_secs(backoff_secs);
        let mut interval = time::interval(Duration::from_millis(200));
        let deadline = time::Instant::now() + sleep_duration;

        while time::Instant::now() < deadline {
            interval.tick().await;
            if shutdown.load(Ordering::Relaxed) {
                info!("[Bridge] Shutdown during reconnect backoff");
                return;
            }
        }

        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
    }
}

async fn run_stream_io<R, W>(
    read_half: R,
    write_half: W,
    capture_cons: &Arc<tokio::sync::Mutex<HeapCons<u8>>>,
    playback_prod: &Arc<tokio::sync::Mutex<HeapProd<u8>>>,
    shutdown: &Arc<AtomicBool>,
) where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let send_shutdown = Arc::clone(shutdown);
    let send_cons = Arc::clone(capture_cons);
    let recv_shutdown = Arc::clone(shutdown);
    let recv_prod = Arc::clone(playback_prod);

    tokio::select! {
        result = send_loop(write_half, send_cons, send_shutdown) => {
            if let Err(e) = result {
                warn!("[Bridge] Send loop ended with error: {}", e);
            }
        }
        result = recv_loop(read_half, recv_prod, recv_shutdown) => {
            if let Err(e) = result {
                warn!("[Bridge] Recv loop ended with error: {}", e);
            }
        }
    }
}

async fn send_loop<W>(
    mut writer: W,
    capture_cons: Arc<tokio::sync::Mutex<HeapCons<u8>>>,
    shutdown: Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    W: AsyncWrite + Unpin,
{
    let mut send_buf = vec![0u8; MAX_FRAME_BYTES];
    let mut interval = time::interval(Duration::from_millis(SEND_INTERVAL_MS));

    loop {
        interval.tick().await;

        if shutdown.load(Ordering::Relaxed) {
            return Ok(());
        }

        let available = {
            let mut cons = capture_cons.lock().await;
            cons.pop_slice(&mut send_buf)
        };

        if available > 0 {
            let len_bytes = (available as u32).to_le_bytes();
            writer.write_all(&len_bytes).await?;
            writer.write_all(&send_buf[..available]).await?;
            writer.flush().await?;
        }
    }
}

async fn recv_loop<R>(
    mut reader: R,
    playback_prod: Arc<tokio::sync::Mutex<HeapProd<u8>>>,
    shutdown: Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    R: AsyncRead + Unpin,
{
    let mut len_buf = [0u8; 4];
    let mut recv_buf = vec![0u8; MAX_FRAME_BYTES * 2];

    loop {
        if shutdown.load(Ordering::Relaxed) {
            return Ok(());
        }

        reader.read_exact(&mut len_buf).await?;
        let payload_len = u32::from_le_bytes(len_buf) as usize;

        if payload_len == 0 {
            continue;
        }

        if payload_len > recv_buf.len() {
            error!("[Bridge] Oversized frame: {} bytes (max {})", payload_len, recv_buf.len());
            let mut remaining = payload_len;
            while remaining > 0 {
                let to_read = remaining.min(recv_buf.len());
                reader.read_exact(&mut recv_buf[..to_read]).await?;
                remaining -= to_read;
            }
            continue;
        }

        reader.read_exact(&mut recv_buf[..payload_len]).await?;

        let mut prod = playback_prod.lock().await;
        let written = prod.push_slice(&recv_buf[..payload_len]);
        if written < payload_len {
            warn!("[Bridge] Playback buffer full, dropped {} bytes", payload_len - written);
        }
    }
}
