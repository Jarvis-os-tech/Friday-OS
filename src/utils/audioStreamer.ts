/**
 * AudioStreamer v2 — AudioWorklet-based 16kHz capture + 24kHz gapless playback
 * Fixes ScriptProcessor deprecation (main-thread crackle). Worklet runs off-thread.
 * Falls back to ScriptProcessor if AudioWorklet unsupported.
 */

export class AudioStreamer {
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null; // fallback
  private micAnalyser: AnalyserNode | null = null;

  private outputGainNode: GainNode | null = null;
  private outputCompressor: DynamicsCompressorNode | null = null;
  private outputFilter: BiquadFilterNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;

  private nextScheduledTime = 0;
  private activeSourceNodes: AudioBufferSourceNode[] = [];
  private isCapturing = false;
  private isMuted = false;
  private isPlaying = false;

  private onAudioChunkCallback: ((base64Chunk: string, rms: number) => void) | null = null;
  private onVoiceActivityCallback: ((isSpeaking: boolean) => void) | null = null;

  public noiseGateThreshold = 0.015;
  private vadSilenceTimer: any = null;
  private consecutiveSpeechFrames = 0;
  private isUserSpeaking = false;
  private workletReady = false;

  public micDataArray: Uint8Array = new Uint8Array(64);
  public agentDataArray: Uint8Array = new Uint8Array(64);

  constructor() {}

  public async initAudio(): Promise<boolean> {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.inputAudioCtx || this.inputAudioCtx.state === 'closed') {
        this.inputAudioCtx = new AudioContextClass({ sampleRate: 16000 });
      }
      if (!this.outputAudioCtx || this.outputAudioCtx.state === 'closed') {
        this.outputAudioCtx = new AudioContextClass({ sampleRate: 24000 });
      }
      if (this.inputAudioCtx.state === 'suspended') await this.inputAudioCtx.resume();
      if (this.outputAudioCtx.state === 'suspended') await this.outputAudioCtx.resume();

      // Load Worklet module once (idempotent)
      if (this.inputAudioCtx.audioWorklet && !this.workletReady) {
        try {
          await this.inputAudioCtx.audioWorklet.addModule('/pcm-capture-processor.js');
          this.workletReady = true;
          console.log('[AudioStreamer] AudioWorklet module loaded');
        } catch (e) {
          console.warn('[AudioStreamer] Worklet load failed, will fallback to ScriptProcessor', e);
          this.workletReady = false;
        }
      }

      if (!this.outputGainNode) {
        this.outputGainNode = this.outputAudioCtx.createGain();
        this.outputGainNode.gain.setValueAtTime(1.0, this.outputAudioCtx.currentTime);

        this.outputCompressor = this.outputAudioCtx.createDynamicsCompressor();
        this.outputCompressor.threshold.setValueAtTime(-10, this.outputAudioCtx.currentTime);
        this.outputCompressor.knee.setValueAtTime(12, this.outputAudioCtx.currentTime);
        this.outputCompressor.ratio.setValueAtTime(3.5, this.outputAudioCtx.currentTime);
        this.outputCompressor.attack.setValueAtTime(0.005, this.outputAudioCtx.currentTime);
        this.outputCompressor.release.setValueAtTime(0.12, this.outputAudioCtx.currentTime);

        this.outputFilter = this.outputAudioCtx.createBiquadFilter();
        this.outputFilter.type = 'lowpass';
        this.outputFilter.frequency.setValueAtTime(11500, this.outputAudioCtx.currentTime);
        this.outputFilter.Q.setValueAtTime(0.707, this.outputAudioCtx.currentTime);

        this.outputAnalyser = this.outputAudioCtx.createAnalyser();
        this.outputAnalyser.fftSize = 128;
        this.outputAnalyser.smoothingTimeConstant = 0.82;

        this.outputGainNode.connect(this.outputCompressor);
        this.outputCompressor.connect(this.outputFilter);
        this.outputFilter.connect(this.outputAnalyser);
        this.outputAnalyser.connect(this.outputAudioCtx.destination);
      }
      return true;
    } catch (err) {
      console.error('Audio initialization error:', err);
      return false;
    }
  }

  // Base64 encode Uint8 bytes without stack blowup
  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 8192;
    for (let off = 0; off < bytes.length; off += CHUNK) {
      const slice = bytes.subarray(off, Math.min(off + CHUNK, bytes.length));
      let chunkStr = '';
      for (let i = 0; i < slice.length; i++) chunkStr += String.fromCharCode(slice[i]);
      binary += chunkStr;
    }
    return btoa(binary);
  }

  public async startMicrophone(
    onChunk: (base64Chunk: string, rms: number) => void,
    onVoiceActivity?: (isSpeaking: boolean) => void
  ): Promise<boolean> {
    try {
      await this.initAudio();
      this.onAudioChunkCallback = onChunk;
      this.onVoiceActivityCallback = onVoiceActivity || null;

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      if (!this.inputAudioCtx) return false;

      this.micSource = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);
      this.micAnalyser = this.inputAudioCtx.createAnalyser();
      this.micAnalyser.fftSize = 128;
      this.micAnalyser.smoothingTimeConstant = 0.75;
      this.micSource.connect(this.micAnalyser);

      // Prefer AudioWorklet, fallback to ScriptProcessor
      if (this.workletReady && this.inputAudioCtx.audioWorklet) {
        this.workletNode = new AudioWorkletNode(this.inputAudioCtx, 'pcm-capture-processor', {
          processorOptions: { chunkSamples: 2048 },
        });

        this.workletNode.port.onmessage = (event: MessageEvent) => {
          if (!this.isCapturing || this.isMuted) return;
          const msg = event.data;
          if (msg.type === 'pcm' && msg.pcmBuffer) {
            const bytes = new Uint8Array(msg.pcmBuffer as ArrayBuffer);
            const base64 = this.bytesToBase64(bytes);
            this.onAudioChunkCallback?.(base64, msg.rms || 0);
          } else if (msg.type === 'vad') {
            // Worklet-side VAD (debounced: 3 speech frames + 6 silence frames hangover)
            if (msg.speaking && !this.isUserSpeaking) {
              this.isUserSpeaking = true;
              this.onVoiceActivityCallback?.(true);
            } else if (!msg.speaking && this.isUserSpeaking) {
              this.isUserSpeaking = false;
              this.onVoiceActivityCallback?.(false);
            }
          }
        };

        // Worklet needs to be connected to destination to stay alive (but silent via zero gain)
        // We connect via analyser so visualizer still works, plus a silent gain to destination
        const silentGain = this.inputAudioCtx.createGain();
        silentGain.gain.value = 0;
        this.micAnalyser.connect(this.workletNode);
        this.workletNode.connect(silentGain);
        silentGain.connect(this.inputAudioCtx.destination);

        console.log('[AudioStreamer] Microphone via AudioWorklet (2048 samples ~128ms)');
      } else {
        // Fallback: ScriptProcessor (deprecated but works)
        console.warn('[AudioStreamer] Using ScriptProcessor fallback');
        this.micProcessor = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);
        this.micProcessor.onaudioprocess = (event) => {
          if (!this.isCapturing || this.isMuted) return;
          const inputChannelData = event.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < inputChannelData.length; i++) sumSquares += inputChannelData[i] * inputChannelData[i];
          const rms = Math.sqrt(sumSquares / inputChannelData.length);

          if (rms > this.noiseGateThreshold) {
            this.consecutiveSpeechFrames++;
            if (this.consecutiveSpeechFrames >= 3 && !this.isUserSpeaking) {
              this.isUserSpeaking = true;
              this.onVoiceActivityCallback?.(true);
            }
            if (this.vadSilenceTimer) { clearTimeout(this.vadSilenceTimer); this.vadSilenceTimer = null; }
          } else {
            this.consecutiveSpeechFrames = 0;
            if (this.isUserSpeaking && !this.vadSilenceTimer) {
              this.vadSilenceTimer = setTimeout(() => {
                this.isUserSpeaking = false;
                this.onVoiceActivityCallback?.(false);
                this.vadSilenceTimer = null;
              }, 750);
            }
          }

          const pcm16Buffer = new ArrayBuffer(inputChannelData.length * 2);
          const view = new DataView(pcm16Buffer);
          let offset = 0;
          for (let i = 0; i < inputChannelData.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, inputChannelData[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          }
          const bytes = new Uint8Array(pcm16Buffer);
          const base64 = this.bytesToBase64(bytes);
          this.onAudioChunkCallback?.(base64, rms);
        };
        this.micAnalyser.connect(this.micProcessor);
        this.micProcessor.connect(this.inputAudioCtx.destination);
      }

      this.isCapturing = true;
      this.isUserSpeaking = false;
      this.consecutiveSpeechFrames = 0;
      return true;
    } catch (err) {
      console.error('Error starting microphone capture:', err);
      return false;
    }
  }

  public stopMicrophone() {
    this.isCapturing = false;
    this.isUserSpeaking = false;
    this.consecutiveSpeechFrames = 0;
    if (this.vadSilenceTimer) { clearTimeout(this.vadSilenceTimer); this.vadSilenceTimer = null; }

    if (this.workletNode) {
      try { this.workletNode.port.onmessage = null; this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }
    if (this.micProcessor) {
      try { this.micProcessor.disconnect(); } catch {}
      this.micProcessor = null;
    }
    if (this.micAnalyser) {
      try { this.micAnalyser.disconnect(); } catch {}
      this.micAnalyser = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch {}
      this.micSource = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  public setMute(muted: boolean) { this.isMuted = muted; }
  public getMute(): boolean { return this.isMuted; }

  public setVolume(volume: number) {
    if (this.outputGainNode && this.outputAudioCtx) {
      this.outputGainNode.gain.setValueAtTime(Math.max(0, Math.min(1.5, volume)), this.outputAudioCtx.currentTime);
    }
  }

  public playPcmChunk(base64Data: string, sampleRate = 24000) {
    if (!this.outputAudioCtx || !this.outputGainNode) { this.initAudio(); }
    if (!this.outputAudioCtx || !this.outputGainNode) return;
    try {
      if (this.outputAudioCtx.state === 'suspended') this.outputAudioCtx.resume();
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      if (len === 0) return;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      const sampleCount = Math.floor(len / 2);
      if (sampleCount <= 0) return;
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, len);
      const float32Array = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        float32Array[i] = int16 < 0 ? int16 / 32768 : int16 / 32767;
      }
      const audioBuffer = this.outputAudioCtx.createBuffer(1, sampleCount, sampleRate);
      audioBuffer.getChannelData(0).set(float32Array);
      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputGainNode);
      const currentTime = this.outputAudioCtx.currentTime;
      if (this.nextScheduledTime < currentTime) {
        this.nextScheduledTime = currentTime + 0.065;
        this.isPlaying = true;
      }
      source.start(this.nextScheduledTime);
      this.nextScheduledTime += audioBuffer.duration;
      this.activeSourceNodes.push(source);
      source.onended = () => {
        const idx = this.activeSourceNodes.indexOf(source);
        if (idx > -1) this.activeSourceNodes.splice(idx, 1);
        if (this.activeSourceNodes.length === 0) this.isPlaying = false;
      };
    } catch (err) {
      console.error('Error decoding/playing PCM audio chunk:', err);
    }
  }

  public interrupt() {
    if (!this.outputAudioCtx || !this.outputGainNode) return;
    try {
      const currentTime = this.outputAudioCtx.currentTime;
      this.outputGainNode.gain.cancelScheduledValues(currentTime);
      this.outputGainNode.gain.setValueAtTime(this.outputGainNode.gain.value, currentTime);
      this.outputGainNode.gain.linearRampToValueAtTime(0.0001, currentTime + 0.015);
      setTimeout(() => {
        for (const source of this.activeSourceNodes) {
          try { source.stop(); source.disconnect(); } catch {}
        }
        this.activeSourceNodes = [];
        this.nextScheduledTime = 0;
        this.isPlaying = false;
        if (this.outputGainNode && this.outputAudioCtx) {
          this.outputGainNode.gain.cancelScheduledValues(this.outputAudioCtx.currentTime);
          this.outputGainNode.gain.setValueAtTime(1.0, this.outputAudioCtx.currentTime);
        }
      }, 20);
    } catch (err) {
      console.error('Interrupt error:', err);
    }
  }

  public updateFrequencyData() {
    if (this.micAnalyser) this.micAnalyser.getByteFrequencyData(this.micDataArray);
    if (this.outputAnalyser) this.outputAnalyser.getByteFrequencyData(this.agentDataArray);
  }

  public isAgentSpeaking(): boolean {
    return this.activeSourceNodes.length > 0 || this.isPlaying;
  }

  public close() {
    this.stopMicrophone();
    this.interrupt();
    if (this.inputAudioCtx) { try { this.inputAudioCtx.close(); } catch {} this.inputAudioCtx = null; }
    if (this.outputAudioCtx) { try { this.outputAudioCtx.close(); } catch {} this.outputAudioCtx = null; }
  }
}
