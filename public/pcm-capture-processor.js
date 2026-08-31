// Friday-OS Audio Worklet Processor — runs off main thread for clean 16kHz capture
// @ts-nocheck — this file loads as AudioWorklet, not bundled TypeScript
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSamples = (options && options.processorOptions && options.processorOptions.chunkSamples) || 2048;
    this.buffer = new Float32Array(this.chunkSamples);
    this.bufIdx = 0;
    this.silenceThreshold = 0.015;
    this.consecutiveSpeech = 0;
    this.isSpeaking = false;
    this.silenceFrames = 0;
    // 750ms hangover at 16kHz with 2048 chunk = ~5.86 frames -> 6 frames
    this.hangoverFrames = 6;
  }

  // Convert float [-1,1] to 16-bit PCM LE bytes then base64 (chunked to avoid stack overflow)
  floatToBase64(floats) {
    const len = floats.length;
    const pcm = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(pcm.buffer);
    // chunked base64 to avoid large string charCode blowup
    let binary = '';
    const CHUNK = 8192;
    for (let off = 0; off < bytes.length; off += CHUNK) {
      const slice = bytes.subarray(off, Math.min(off + CHUNK, bytes.length));
      let chunkStr = '';
      for (let j = 0; j < slice.length; j++) chunkStr += String.fromCharCode(slice[j]);
      binary += chunkStr;
    }
    // Use btoa equivalent — worklet has no btoa, build manually via port message
    // We send raw bytes length + option: send as ArrayBuffer transfer
    return { bytesLen: bytes.length, pcm };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // RMS for this 128-sample render quantum
    let sumSq = 0;
    for (let i = 0; i < channel.length; i++) sumSq += channel[i] * channel[i];
    const rms = Math.sqrt(sumSq / channel.length);

    // Accumulate into 2048 buffer for Gemini chunking
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufIdx++] = channel[i];
      if (this.bufIdx >= this.chunkSamples) {
        // Compute chunk RMS
        let cSum = 0;
        for (let k = 0; k < this.chunkSamples; k++) cSum += this.buffer[k] * this.buffer[k];
        const chunkRms = Math.sqrt(cSum / this.chunkSamples);

        // Convert to PCM bytes and send
        const pcm = new Int16Array(this.chunkSamples);
        for (let k = 0; k < this.chunkSamples; k++) {
          const s = Math.max(-1, Math.min(1, this.buffer[k]));
          pcm[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        // Transfer as ArrayBuffer to avoid base64 overhead on worklet thread
        // Main thread will base64-encode for Gemini WSS
        this.port.postMessage(
          { type: 'pcm', pcmBuffer: pcm.buffer, rms: chunkRms },
          [pcm.buffer]
        );
        // Reset buffer with new allocation (transferred)
        this.buffer = new Float32Array(this.chunkSamples);
        this.bufIdx = 0;

        // VAD state (debounced: 3 frames required, 6-frame hangover)
        if (chunkRms > this.silenceThreshold) {
          this.consecutiveSpeech++;
          if (this.consecutiveSpeech >= 3 && !this.isSpeaking) {
            this.isSpeaking = true;
            this.silenceFrames = 0;
            this.port.postMessage({ type: 'vad', speaking: true, rms: chunkRms });
          } else if (this.isSpeaking) {
            this.silenceFrames = 0;
          }
        } else {
          this.consecutiveSpeech = 0;
          if (this.isSpeaking) {
            this.silenceFrames++;
            if (this.silenceFrames >= this.hangoverFrames) {
              this.isSpeaking = false;
              this.port.postMessage({ type: 'vad', speaking: false, rms: chunkRms });
              this.silenceFrames = 0;
            }
          }
        }
      }
    }

    // Also send per-quantum rms for visualizer (throttled: every 4 quanta ~512 samples ~32ms)
    // We piggyback on pcm chunks mostly; visualizer reads AnalyserNode instead
    
    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
