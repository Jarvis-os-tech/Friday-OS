import React, { useState } from 'react';
import { VoiceSettings, VoicePreset } from '../types';
import {
  X,
  Volume2,
  Mic,
  Sliders,
  Sparkles,
  Check,
  Play,
  Settings2,
  ShieldCheck,
  Cpu,
} from 'lucide-react';

interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: VoiceSettings;
  onUpdateSettings: (newSettings: Partial<VoiceSettings>) => void;
  voices: VoicePreset[];
  micVolume: number;
}

export const AudioSettingsModal: React.FC<AudioSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  voices,
  micVolume,
}) => {
  const [testingVoiceId, setTestingVoiceId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTestVoice = async (voiceName: string) => {
    try {
      setTestingVoiceId(voiceName);
      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Hello! I am ${voiceName}, with natural prosody and ultra-fast thinking response.`,
          voiceName,
        }),
      });
      const data = await res.json();
      if (data.audio) {
        // Play sample audio at 24kHz
        const binary = atob(data.audio);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const sampleCount = Math.floor(len / 2);
        const dataView = new DataView(bytes.buffer, bytes.byteOffset, len);
        const float32 = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
          const int16 = dataView.getInt16(i * 2, true);
          float32[i] = int16 < 0 ? int16 / 32768 : int16 / 32767;
        }

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000,
        });
        const buffer = audioCtx.createBuffer(1, sampleCount, 24000);
        buffer.getChannelData(0).set(float32);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);
      }
    } catch (e) {
      console.warn('Voice preview error:', e);
    } finally {
      setTimeout(() => setTestingVoiceId(null), 1800);
    }
  };

  return (
    <div
      id="audio-settings-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
    >
      <div
        id="audio-settings-modal"
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden flex flex-col max-h-[90vh] shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-slate-800 text-cyan-400">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-mono text-slate-100">F.R.I.D.A.Y. CONFIGURATION</h3>
              <p className="text-xs text-slate-400 font-mono">Speech engine, prosody synthesis & acoustic telemetry</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 bg-slate-800/60 hover:bg-slate-800 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Voice Presets */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-indigo-400" />
                Select Voice Model
              </label>
              <span className="text-[11px] text-slate-400">Gemini 3.1 Flash Live Speech Engine</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {voices.map((v) => {
                const isSelected = settings.voiceName === v.id;
                const isTesting = testingVoiceId === v.id;

                return (
                  <div
                    key={v.id}
                    onClick={() => onUpdateSettings({ voiceName: v.id })}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500 shadow-sm ring-1 ring-indigo-500/50'
                        : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/40'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-100">{v.name}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                            {v.gender}
                          </span>
                        </div>
                        {isSelected && (
                          <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-indigo-300 font-mono mb-1">{v.tone}</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">{v.description}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-auto">
                      <span className="text-[10px] font-mono text-cyan-400 font-semibold">{v.badge}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTestVoice(v.name);
                        }}
                        disabled={isTesting}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <Play className="w-3 h-3" />
                        {isTesting ? 'Playing...' : 'Test Voice'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Conversational Filler Behavior */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                Thinking Filler Strategy
              </label>
              <span className="text-[11px] text-slate-400">Natural conversational pacing</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                {
                  id: 'reactive_fillers',
                  title: 'Reactive Spoken Fillers',
                  desc: 'Starts speaking immediately ("On it...", "Looking into that...") while computing.',
                  badge: 'Recommended',
                },
                {
                  id: 'minimal_fillers',
                  title: 'Direct Fast Speech',
                  desc: 'Minimal intro phrases, delivers direct concise answer instantly.',
                  badge: 'Ultra Fast',
                },
                {
                  id: 'disabled',
                  title: 'No Fillers',
                  desc: 'Silent latency until complete reasoning stream begins.',
                  badge: 'Direct',
                },
              ].map((f) => {
                const isSelected = settings.fillerStyle === f.id;
                return (
                  <div
                    key={f.id}
                    onClick={() => onUpdateSettings({ fillerStyle: f.id as any })}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-500 ring-1 ring-cyan-500/50'
                        : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-slate-200">{f.title}</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                        {f.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Acoustic & Telemetry Controls */}
          <div className="space-y-4 pt-4 border-t border-slate-800/80">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-teal-400" />
              Microphone Sensitivity & Noise Gate
            </label>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-300 font-medium">
                  Voice Activity Threshold (Noise Gate)
                </label>
                <span className="text-xs font-mono text-teal-400 font-semibold">
                  {(settings.noiseGateThreshold * 1000).toFixed(1)} mRMS
                </span>
              </div>
              <input
                type="range"
                min="0.001"
                max="0.03"
                step="0.001"
                value={settings.noiseGateThreshold}
                onChange={(e) =>
                  onUpdateSettings({ noiseGateThreshold: parseFloat(e.target.value) })
                }
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                <span>Higher Sensitivity (Quiet Rooms)</span>
                <span>Lower Sensitivity (Noisy Backgrounds)</span>
              </div>
            </div>

            {/* Live Audio Level Meter */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center gap-3">
              <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
                Live Mic Level:
              </span>
              <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 via-emerald-400 to-amber-400 rounded-full transition-all duration-75"
                  style={{ width: `${Math.min(100, micVolume * 400)}%` }}
                />
              </div>
            </div>

            {/* Auto Interrupt Toggle */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/40 border border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                <div>
                  <span className="text-xs font-bold text-slate-200 block">
                    Seamless Voice Interruption
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Immediately cuts model speech when you start talking aloud
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoInterrupt}
                onChange={(e) => onUpdateSettings({ autoInterrupt: e.target.checked })}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-slate-800 border-slate-700 cursor-pointer"
              />
            </div>
          </div>

          {/* Custom Persona Context */}
          <div className="pt-4 border-t border-slate-800/80">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-1.5">
              Custom Persona / Role Instructions
            </label>
            <textarea
              rows={2}
              value={settings.customContext}
              onChange={(e) => onUpdateSettings({ customContext: e.target.value })}
              placeholder="e.g., Act as a senior aerospace engineer and speak concisely; or You are a friendly bilingual tutor."
              className="w-full px-3.5 py-2.5 text-xs bg-slate-950/70 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-800 bg-slate-950/40">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-mono font-bold bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl shadow-lg transition-all"
          >
            CONFIRM & CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
