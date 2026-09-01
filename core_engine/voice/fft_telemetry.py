"""
Real-Time Audio FFT Spectrum & Energy Extractor for J.A.R.V.I.S.
Computes 80-band frequency spectrum and RMS volume energy from raw PCM frames
and streams telemetry to the React 19 Arc-Reactor Radial Orbit HUD.
"""

import time
import math
import struct
import json
import asyncio
from typing import List, Optional

try:
    import numpy as np
except ImportError:
    np = None

class FFTTelemetryProcessor:
    def __init__(self, num_bands: int = 80, sample_rate: int = 24000):
        self.num_bands = num_bands
        self.sample_rate = sample_rate
        self.smoothing_factor = 0.65
        self.prev_bands = [0.0] * num_bands

    def process_pcm_frame(self, pcm_bytes: bytes) -> dict:
        """
        Process raw 16-bit PCM bytes and return volume + 80-band FFT spectrum.
        """
        if not pcm_bytes:
            return {"volume": 0.0, "frequencies": [0.0] * self.num_bands}

        num_samples = len(pcm_bytes) // 2
        if num_samples < 64:
            return {"volume": 0.0, "frequencies": self.prev_bands}

        # Unpack 16-bit signed PCM samples
        try:
            samples = struct.unpack(f"<{num_samples}h", pcm_bytes[:num_samples * 2])
        except Exception:
            return {"volume": 0.0, "frequencies": self.prev_bands}

        # 1. Compute RMS Volume (Normalized 0.0 - 1.0)
        sum_squares = sum(s * s for s in samples)
        rms = math.sqrt(sum_squares / num_samples) if num_samples > 0 else 0.0
        normalized_volume = min(1.0, max(0.0, rms / 12000.0))

        # 2. Compute 80-band frequency distribution
        if np is not None and num_samples >= 256:
            audio_data = np.array(samples, dtype=np.float32) / 32768.0
            # Apply Hanning window
            window = np.hanning(len(audio_data))
            fft_data = np.abs(np.fft.rfft(audio_data * window))
            
            # Group into 80 log-spaced frequency bands
            fft_len = len(fft_data)
            bands = []
            band_size = max(1, fft_len // self.num_bands)
            for i in range(self.num_bands):
                start = i * band_size
                end = min(fft_len, (i + 1) * band_size)
                if start < end:
                    band_val = float(np.mean(fft_data[start:end])) * 4.0
                else:
                    band_val = 0.0
                # Smooth with previous frame
                smoothed = (self.prev_bands[i] * self.smoothing_factor) + (band_val * (1.0 - self.smoothing_factor))
                bands.append(min(1.0, max(0.0, smoothed)))
            self.prev_bands = bands
        else:
            # Synthetic distribution based on volume when numpy is unavailable
            bands = []
            for i in range(self.num_bands):
                # Shape response curve around vocal center
                center = self.num_bands * 0.35
                dist = abs(i - center) / self.num_bands
                factor = math.exp(-dist * 4.0)
                band_val = normalized_volume * factor
                smoothed = (self.prev_bands[i] * self.smoothing_factor) + (band_val * (1.0 - self.smoothing_factor))
                bands.append(min(1.0, max(0.0, smoothed)))
            self.prev_bands = bands

        return {
            "type": "audio_telemetry",
            "volume": normalized_volume,
            "frequencies": self.prev_bands,
            "timestamp": time.time()
        }
