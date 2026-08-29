import React from 'react';
import { TelemetryMetrics, AgentStatus } from '../types';
import { Activity, Radio, Cpu, Gauge, Zap, Sparkles } from 'lucide-react';

interface ThinkingMetricsProps {
  metrics: TelemetryMetrics;
  status: AgentStatus;
  voiceName: string;
  fillerStyle: string;
}

export const ThinkingMetrics: React.FC<ThinkingMetricsProps> = ({
  metrics,
  status,
  voiceName,
  fillerStyle,
}) => {
  const getStatusColor = (st: AgentStatus) => {
    switch (st) {
      case 'speaking':
        return 'bg-indigo-500 text-indigo-100 border-indigo-400/40 shadow-indigo-500/20';
      case 'listening':
        return 'bg-teal-500 text-teal-100 border-teal-400/40 shadow-teal-500/20';
      case 'thinking':
        return 'bg-amber-500 text-amber-100 border-amber-400/40 shadow-amber-500/20';
      case 'connecting':
        return 'bg-blue-500 text-blue-100 border-blue-400/40 shadow-blue-500/20';
      case 'interrupted':
        return 'bg-rose-500 text-rose-100 border-rose-400/40 shadow-rose-500/20';
      default:
        return 'bg-slate-700 text-slate-300 border-slate-600/40';
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      id="thinking-telemetry-dashboard"
      className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md"
    >
      {/* Current State */}
      <div className="flex flex-col justify-between p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Agent State
          </span>
          <div className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className={`px-2 py-0.5 text-xs font-semibold rounded-md border shadow-sm capitalize ${getStatusColor(
              status
            )}`}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Latency & Flash Speed */}
      <div className="flex flex-col justify-between p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Flash Latency
          </span>
          <Zap className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-base font-bold font-mono text-emerald-400">
            {metrics.roundTripLatencyMs > 0 ? metrics.roundTripLatencyMs : '~120'}
          </span>
          <span className="text-[10px] text-slate-400">ms (ultra-low)</span>
        </div>
      </div>

      {/* Speech Audio Sample Rates */}
      <div className="flex flex-col justify-between p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Audio Sample Stream
          </span>
          <Radio className="w-3.5 h-3.5 text-teal-400" />
        </div>
        <div className="mt-1 text-xs font-mono text-slate-200">
          <span className="text-teal-400 font-semibold">16k</span> In /{' '}
          <span className="text-indigo-400 font-semibold">24k</span> Out
        </div>
      </div>

      {/* Reactive Fillers & Parallel Prosody */}
      <div className="flex flex-col justify-between p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Reactive Fillers
          </span>
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-xs font-semibold text-indigo-300">Active</span>
          <span className="text-[10px] text-slate-400 truncate">
            ({metrics.fillersUsedCount} triggered)
          </span>
        </div>
      </div>

      {/* Session Duration & Voice Profile */}
      <div className="hidden lg:flex flex-col justify-between p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Active Session
          </span>
          <Activity className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="mt-1 text-xs font-mono text-slate-200 flex items-center justify-between">
          <span>{formatDuration(metrics.sessionDurationSec)}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-indigo-300 rounded font-medium">
            {voiceName}
          </span>
        </div>
      </div>
    </div>
  );
};
