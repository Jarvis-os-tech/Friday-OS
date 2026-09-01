use std::error::Error;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::Consumer;
use ringbuf::HeapCons;
use tracing::{debug, error, info, warn};

/// Runs the speaker playback loop on a dedicated OS thread with resilient auto-reconnect.
///
/// Reads raw 24kHz, mono, i16 PCM bytes from the ring buffer consumer
/// (fed by the TCP bridge) and plays them through the default output device.
/// Automatically recovers from sound server disconnects and PipeWire/ALSA restarts.
pub fn run(
    consumer: HeapCons<u8>,
    sample_rate: u32,
    shutdown: Arc<AtomicBool>,
) -> Result<(), Box<dyn Error>> {
    let consumer = Arc::new(Mutex::new(consumer));

    while !shutdown.load(Ordering::Relaxed) {
        let host = cpal::default_host();

        let device = match host.default_output_device() {
            Some(d) => d,
            None => {
                warn!("[Playback] No default output audio device found. Retrying in 1s...");
                std::thread::sleep(Duration::from_millis(1000));
                continue;
            }
        };

        let device_name = device.name().unwrap_or_else(|_| "unknown".into());
        info!("[Playback] Output device: {}", device_name);

        let desired_config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        info!("[Playback] Starting stream: {}Hz, mono, i16", sample_rate);

        let stream_error_flag = Arc::new(AtomicBool::new(false));
        let error_notifier = Arc::clone(&stream_error_flag);

        let cb_consumer = Arc::clone(&consumer);
        let stream = match device.build_output_stream(
            &desired_config,
            move |data: &mut [i16], _info: &cpal::OutputCallbackInfo| {
                let bytes_needed = data.len() * std::mem::size_of::<i16>();
                let output_bytes = u8_slice_from_i16_mut(data);

                let raw_read = if let Ok(mut cons) = cb_consumer.try_lock() {
                    cons.pop_slice(&mut output_bytes[..bytes_needed])
                } else {
                    0
                };

                // Guarantee 16-bit integer boundary alignment (2 bytes per sample)
                let even_bytes = (raw_read / 2) * 2;
                let samples_read = even_bytes / 2;

                if samples_read < data.len() {
                    data[samples_read..].fill(0);
                    if raw_read != 0 {
                        debug!(
                            "[Playback] Buffer underrun: got {} of {} bytes",
                            raw_read, bytes_needed
                        );
                    }
                }
            },
            move |err| {
                error!("[Playback] Stream error encountered: {}", err);
                error_notifier.store(true, Ordering::SeqCst);
            },
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                warn!("[Playback] Failed to build output stream: {}. Retrying in 1s...", e);
                std::thread::sleep(Duration::from_millis(1000));
                continue;
            }
        };

        if let Err(e) = stream.play() {
            warn!("[Playback] Failed to start stream playback: {}. Retrying in 1s...", e);
            std::thread::sleep(Duration::from_millis(1000));
            continue;
        }

        info!("[Playback] Speaker stream active");

        // Maintain playback until shutdown or stream error occurs
        while !shutdown.load(Ordering::Relaxed) && !stream_error_flag.load(Ordering::Relaxed) {
            std::thread::park_timeout(Duration::from_millis(100));
        }

        drop(stream);

        if stream_error_flag.load(Ordering::Relaxed) && !shutdown.load(Ordering::Relaxed) {
            warn!("[Playback] Sound server interruption detected. Rebuilding audio stream...");
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    info!("[Playback] Stopped");
    Ok(())
}

fn u8_slice_from_i16_mut(data: &mut [i16]) -> &mut [u8] {
    unsafe {
        std::slice::from_raw_parts_mut(
            data.as_mut_ptr() as *mut u8,
            data.len() * std::mem::size_of::<i16>(),
        )
    }
}
