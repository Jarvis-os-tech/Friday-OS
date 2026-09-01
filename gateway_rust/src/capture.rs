use std::error::Error;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::Producer;
use ringbuf::HeapProd;
use tracing::{debug, error, info, warn};

/// Runs the microphone capture loop on a dedicated OS thread with resilient auto-reconnect.
///
/// Captures 16kHz, mono, i16 PCM from the default input device and writes
/// raw bytes into the ring buffer producer. Automatically recovers from PipeWire/ALSA interruptions.
pub fn run(
    producer: HeapProd<u8>,
    sample_rate: u32,
    shutdown: Arc<AtomicBool>,
) -> Result<(), Box<dyn Error>> {
    let producer = Arc::new(Mutex::new(producer));

    while !shutdown.load(Ordering::Relaxed) {
        let host = cpal::default_host();

        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                warn!("[Capture] No default input audio device found. Retrying in 1s...");
                std::thread::sleep(Duration::from_millis(1000));
                continue;
            }
        };

        let device_name = device.name().unwrap_or_else(|_| "unknown".into());
        info!("[Capture] Input device: {}", device_name);

        let desired_config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        info!("[Capture] Starting stream: {}Hz, mono, i16", sample_rate);

        let stream_error_flag = Arc::new(AtomicBool::new(false));
        let error_notifier = Arc::clone(&stream_error_flag);

        let cb_producer = Arc::clone(&producer);
        let stream = match device.build_input_stream(
            &desired_config,
            move |data: &[i16], _info: &cpal::InputCallbackInfo| {
                let bytes: &[u8] = bytemuck_cast_i16_to_u8(data);
                if let Ok(mut prod) = cb_producer.try_lock() {
                    let written = prod.push_slice(bytes);
                    if written < bytes.len() {
                        debug!(
                            "[Capture] Ring buffer full, dropped {} bytes",
                            bytes.len() - written
                        );
                    }
                }
            },
            move |err| {
                error!("[Capture] Stream error encountered: {}", err);
                error_notifier.store(true, Ordering::SeqCst);
            },
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                warn!("[Capture] Failed to build input stream: {}. Retrying in 1s...", e);
                std::thread::sleep(Duration::from_millis(1000));
                continue;
            }
        };

        if let Err(e) = stream.play() {
            warn!("[Capture] Failed to start input stream: {}. Retrying in 1s...", e);
            std::thread::sleep(Duration::from_millis(1000));
            continue;
        }

        info!("[Capture] Microphone stream active");

        while !shutdown.load(Ordering::Relaxed) && !stream_error_flag.load(Ordering::Relaxed) {
            std::thread::park_timeout(Duration::from_millis(100));
        }

        drop(stream);

        if stream_error_flag.load(Ordering::Relaxed) && !shutdown.load(Ordering::Relaxed) {
            warn!("[Capture] Sound server interruption detected. Rebuilding input stream...");
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    info!("[Capture] Stopped");
    Ok(())
}

fn bytemuck_cast_i16_to_u8(data: &[i16]) -> &[u8] {
    unsafe {
        std::slice::from_raw_parts(
            data.as_ptr() as *const u8,
            data.len() * std::mem::size_of::<i16>(),
        )
    }
}
