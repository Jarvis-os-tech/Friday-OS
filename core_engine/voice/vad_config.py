"""
Silero Neural Voice Activity Detection (VAD) Configuration for J.A.R.V.I.S.
Configured for sub-100ms conversational turn-taking and crisp speech boundary detection.
"""

from dataclasses import dataclass

@dataclass
class JarvisVADConfig:
    # 10ms chunk analysis baseline
    sample_rate: int = 16000
    chunk_size: int = 512
    
    # Confidence threshold for human speech (0.0 to 1.0)
    confidence_threshold: float = 0.70
    
    # Minimum continuous speech duration to trigger activation (ms)
    min_speech_duration_ms: int = 80
    
    # Minimum silence duration to declare end-of-turn (ms)
    # 200-240ms allows natural pauses without premature interruption
    min_silence_duration_ms: int = 220
    
    # Prefix padding to capture initial consonants (ms)
    prefix_padding_ms: int = 100

def get_default_vad_config() -> JarvisVADConfig:
    return JarvisVADConfig()
