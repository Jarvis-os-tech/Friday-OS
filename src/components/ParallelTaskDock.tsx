import React, { useState, useEffect } from 'react';
import {
  BackgroundTask,
  TaskCategory,
  SkillDisplayCard as SkillDisplayCardType,
} from '../types';
import {
  Zap,
  Activity,
  CheckCircle2,
  AlertCircle,
  X,
  Clock,
  ChevronRight,
  CloudSun,
  Newspaper,
  Bell,
  Search,
  FileText,
  Bot,
  Calculator,
  Cpu,
  Layers,
  Sparkles,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

interface ParallelTaskDockProps {
  activeTasks: BackgroundTask[];
  completedTasks: BackgroundTask[];
  onCancelTask: (taskId: string) => void;
  onSelectDisplayCard: (card: SkillDisplayCardType) => void;
  onDismissCompletedTask?: (taskId: string) => void;
}

export const ParallelTaskDock: React.FC<ParallelTaskDockProps> = ({
  activeTasks,
  completedTasks,
  onCancelTask,
  onSelectDisplayCard,
  onDismissCompletedTask,
}) => {
  const [isOpenHistory, setIsOpenHistory] = useState(false);
  const [nowTime, setNowTime] = useState<number>(Date.now());

  // Live timer tick for active task durations
  useEffect(() => {
    if (activeTasks.length === 0) return;
    const interval = setInterval(() => {
      setNowTime(Date.now());
    }, 200);
    return () => clearInterval(interval);
  }, [activeTasks.length]);

  const getCategoryIcon = (category: TaskCategory, className = 'w-3.5 h-3.5') => {
    switch (category) {
      case 'weather':
        return <CloudSun className={className} />;
      case 'news':
        return <Newspaper className={className} />;
      case 'productivity':
        return <Bell className={className} />;
      case 'obsidian':
        return <FileText className={className} />;
      case 'hermes':
        return <Bot className={className} />;
      case 'research':
        return <Search className={className} />;
      case 'calculation':
        return <Calculator className={className} />;
      default:
        return <Cpu className={className} />;
    }
  };

  const getCategoryColor = (category: TaskCategory) => {
    switch (category) {
      case 'weather':
        return 'text-sky-400 border-sky-500/30 bg-sky-950/70';
      case 'news':
        return 'text-indigo-400 border-indigo-500/30 bg-indigo-950/70';
      case 'productivity':
        return 'text-amber-400 border-amber-500/30 bg-amber-950/70';
      case 'obsidian':
        return 'text-emerald-400 border-emerald-500/30 bg-emerald-950/70';
      case 'hermes':
        return 'text-purple-400 border-purple-500/30 bg-purple-950/70';
      case 'research':
        return 'text-cyan-400 border-cyan-500/30 bg-cyan-950/70';
      default:
        return 'text-slate-300 border-slate-700 bg-slate-900/80';
    }
  };

  if (activeTasks.length === 0 && completedTasks.length === 0) {
    return null;
  }

  return (
    <div
      id="parallel-task-dock"
      className="w-full max-w-2xl mx-auto my-2 px-1 transition-all animate-fadeIn"
    >
      {/* Active Tasks Floating Strip */}
      {activeTasks.length > 0 && (
        <div className="space-y-2 mb-2">
          {activeTasks.map((task) => {
            const elapsedSec = ((nowTime - task.startTime) / 1000).toFixed(1);
            return (
              <div
                key={task.id}
                id={`task-active-${task.id}`}
                className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950/95 via-slate-900/90 to-slate-950/95 border border-cyan-500/40 p-3 shadow-xl backdrop-blur-md flex items-center justify-between gap-3 animate-pulse"
              >
                {/* Background holographic progress shimmer */}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-indigo-500/15 to-transparent pointer-events-none transition-all duration-300"
                  style={{ width: `${task.progressPercent || 40}%` }}
                />

                <div className="flex items-center gap-2.5 min-w-0 z-10">
                  <div
                    className={`p-2 rounded-xl border flex items-center justify-center ${getCategoryColor(
                      task.type
                    )} shrink-0`}
                  >
                    {getCategoryIcon(task.type, 'w-4 h-4 animate-spin')}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 uppercase tracking-wider">
                        <Zap className="w-2.5 h-2.5 animate-pulse text-cyan-400" />
                        Parallel Execution
                      </span>
                      <span className="text-xs font-semibold text-white truncate max-w-[180px] sm:max-w-xs">
                        {task.title}
                      </span>
                    </div>

                    <p className="text-[11px] text-cyan-200/90 font-mono mt-0.5 truncate">
                      {task.verbalAcknowledgment || task.progressMessage || 'Processing in background...'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 z-10">
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-900/80 border border-slate-700/60 text-slate-300">
                    {elapsedSec}s
                  </span>
                  <button
                    onClick={() => onCancelTask(task.id)}
                    className="p-1 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors"
                    title="Cancel background task"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Completed Tasks Quick Bar */}
      {completedTasks.length > 0 && activeTasks.length === 0 && (
        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-900/60 border border-slate-800/60 text-xs backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto py-0.5 no-scrollbar">
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider shrink-0 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Parallel Ready ({completedTasks.length}):
            </span>

            {completedTasks.slice(0, 3).map((task) => (
              <button
                key={task.id}
                onClick={() => {
                  if (task.displayCard) {
                    onSelectDisplayCard(task.displayCard);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/80 hover:bg-cyan-950/60 border border-slate-800 hover:border-cyan-500/40 text-[11px] text-slate-200 transition-colors shrink-0"
              >
                {getCategoryIcon(task.type, 'w-3 h-3 text-cyan-400')}
                <span className="truncate max-w-[130px] font-mono font-medium">{task.title}</span>
                {task.durationMs && (
                  <span className="text-[9px] text-slate-500 font-mono">
                    {(task.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsOpenHistory(true)}
            className="text-[11px] font-mono text-cyan-400 hover:text-cyan-200 px-2 py-1 rounded hover:bg-slate-800 shrink-0 transition-colors"
          >
            All Tasks →
          </button>
        </div>
      )}

      {/* Full Task History Modal */}
      {isOpenHistory && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-5 text-slate-100 shadow-2xl animate-scaleUp max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-mono uppercase text-white">
                    Parallel Execution Task Manager
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Background tasks & concurrent data fetches
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpenHistory(false)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto my-3 space-y-2 pr-1">
              {activeTasks.length > 0 && (
                <div className="mb-3">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 mb-1.5 block">
                    Active Concurrent Tasks ({activeTasks.length})
                  </span>
                  {activeTasks.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-center justify-between gap-3 mb-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {getCategoryIcon(t.type, 'w-4 h-4 text-cyan-400 animate-spin')}
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{t.title}</div>
                          <div className="text-[10px] font-mono text-cyan-300/80">
                            {t.progressMessage || 'Running concurrently...'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => onCancelTask(t.id)}
                        className="px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-[10px] font-mono"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">
                  Completed Tasks ({completedTasks.length})
                </span>
                {completedTasks.length === 0 ? (
                  <p className="text-xs text-slate-500 font-mono text-center py-6">
                    No background tasks executed yet.
                  </p>
                ) : (
                  completedTasks.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-3 mb-2 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`p-1.5 rounded-lg border ${getCategoryColor(
                            t.type
                          )} shrink-0`}
                        >
                          {getCategoryIcon(t.type, 'w-3.5 h-3.5')}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{t.title}</div>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 mt-0.5">
                            <span className="capitalize">{t.status}</span>
                            {t.durationMs && <span>• {(t.durationMs / 1000).toFixed(2)}s</span>}
                            <span>• {new Date(t.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>

                      {t.displayCard && (
                        <button
                          onClick={() => {
                            onSelectDisplayCard(t.displayCard!);
                            setIsOpenHistory(false);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-[11px] font-mono shrink-0 transition-colors"
                        >
                          View Card
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setIsOpenHistory(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
