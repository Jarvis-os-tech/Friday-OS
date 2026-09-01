import React from 'react';
import { SkillDisplayCard as SkillCardType } from '../types';
import {
  CloudSun,
  Newspaper,
  Bell,
  CheckCircle2,
  ExternalLink,
  Calculator,
  Wind,
  Droplets,
  Calendar,
  X,
  Bot,
  Search,
  FileText,
  FilePlus,
  Sparkles,
  Terminal,
  Code2,
  ShieldAlert,
  Cpu,
  Activity,
  Sliders,
  Zap,
  Flame,
  Check,
} from 'lucide-react';

interface SkillDisplayCardProps {
  card: SkillCardType;
  onDismiss?: () => void;
  onAction?: (action: string, payload?: any) => void;
}

export const SkillDisplayCard: React.FC<SkillDisplayCardProps> = ({
  card,
  onDismiss,
  onAction,
}) => {
  if (!card) return null;

  const { type, title, data } = card;

  // 1. Weather Forecast Card
  if (type === 'weather') {
    const {
      location,
      temperature,
      feelsLike,
      condition,
      humidity,
      windSpeed,
      forecast = [],
    } = data || {};

    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-sky-950/40 to-slate-900/95 border border-sky-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-3 border-b border-sky-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400">
              <CloudSun className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-sky-300">
                Live Weather
              </span>
              <h3 className="text-sm font-medium text-white truncate max-w-xs">{location}</h3>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 rounded text-slate-400 hover:text-white transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Current Weather Display */}
        <div className="flex items-center justify-between my-3 px-1">
          <div>
            <div className="text-3xl sm:text-4xl font-bold font-mono text-white tracking-tight">
              {temperature}
            </div>
            <div className="text-xs text-sky-200/90 font-medium mt-0.5">{condition}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Feels like {feelsLike}</div>
          </div>

          <div className="flex flex-col gap-1.5 text-[11px] font-mono text-slate-300 bg-slate-800/50 p-2.5 rounded-xl border border-sky-500/10">
            <div className="flex items-center gap-2">
              <Droplets className="w-3.5 h-3.5 text-sky-400" />
              <span>Humidity: {humidity}</span>
            </div>
            <div className="flex items-center gap-2">
              <Wind className="w-3.5 h-3.5 text-sky-400" />
              <span>Wind: {windSpeed}</span>
            </div>
          </div>
        </div>

        {/* 3-Day Forecast Strip */}
        {Array.isArray(forecast) && forecast.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-sky-500/15">
            {forecast.map((f: any, idx: number) => (
              <div
                key={idx}
                className="bg-slate-800/40 rounded-lg p-2 text-center border border-slate-700/50"
              >
                <div className="text-[11px] font-semibold text-slate-300">{f.day}</div>
                <div className="text-xs font-bold text-white font-mono my-0.5">
                  {f.maxTemp}° / {f.minTemp}°
                </div>
                <div className="text-[10px] text-sky-300/80 truncate">{f.condition}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 2. News Headlines Card
  if (type === 'news') {
    const { topic = 'Top', articles = [] } = data || {};

    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-indigo-950/40 to-slate-900/95 border border-indigo-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-indigo-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Newspaper className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-indigo-300">
                Live News Feed
              </span>
              <h3 className="text-xs text-slate-300">
                Top {topic.charAt(0).toUpperCase() + topic.slice(1)} Stories
              </h3>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 rounded text-slate-400 hover:text-white transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="space-y-2.5 my-2.5">
          {articles.map((art: any, i: number) => (
            <div
              key={i}
              className="p-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800/70 border border-slate-700/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <a
                  href={art.link || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-100 hover:text-indigo-300 font-medium leading-snug line-clamp-2 transition-colors"
                >
                  {art.title}
                </a>
                {art.link && (
                  <a
                    href={art.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-indigo-300 shrink-0 p-0.5"
                    title="Open article"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-slate-400">
                <span className="px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/30">
                  {art.source}
                </span>
                {art.pubDate && <span>{new Date(art.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 3. Reminder Created / Listed Card
  if (type === 'reminder_created' || type === 'reminders_list') {
    const reminder = type === 'reminder_created' ? data : null;
    const remindersList = type === 'reminders_list' ? data?.reminders || [] : [];

    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-amber-950/30 to-slate-900/95 border border-amber-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-amber-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-300">
                {type === 'reminder_created' ? 'Reminder Set' : 'Active Reminders'}
              </span>
              <h3 className="text-xs text-slate-300">{title}</h3>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 rounded text-slate-400 hover:text-white transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {reminder && (
          <div className="my-2.5 p-3 rounded-xl bg-amber-950/30 border border-amber-500/20 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-white">{reminder.text}</div>
                <div className="text-[11px] font-mono text-amber-300/80 mt-0.5">
                  Scheduled for {reminder.dueDateString}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
              Active
            </span>
          </div>
        )}

        {remindersList.length > 0 && (
          <div className="space-y-2 my-2.5 max-h-48 overflow-y-auto">
            {remindersList.map((rem: any) => (
              <div
                key={rem.id}
                className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/40 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs text-white font-medium">{rem.text}</div>
                  <div className="text-[10px] font-mono text-amber-300/80">Due {rem.dueDateString}</div>
                </div>
                {onAction && (
                  <button
                    onClick={() => onAction('complete_reminder', rem.id)}
                    className="px-2 py-1 rounded bg-slate-700 hover:bg-amber-600/80 text-white text-[10px] font-mono transition-colors"
                  >
                    Done
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 4. Calculation Card
  if (type === 'calculation') {
    const { expression, result } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-emerald-950/30 to-slate-900/95 border border-emerald-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2 border-b border-emerald-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
              <Calculator className="w-4 h-4" />
            </div>
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-300">
              Computed Result
            </span>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 rounded text-slate-400 hover:text-white transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="my-2 text-sm font-mono text-emerald-300 font-semibold">{result}</div>
      </div>
    );
  }

  // 5. Hermes Personal Assistant — FULL capabilities gateway
  if (type === 'hermes_response') {
    const { text, prompt, sessionId } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-violet-950/40 to-slate-900/95 border border-violet-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-violet-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-violet-500/20 text-violet-400">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-violet-300">
                Hermes • Full Access Gateway
              </span>
              <h3 className="text-xs text-slate-300 truncate max-w-xs" title={title}>
                {title}
              </h3>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* The exact command FRIDAY delegated to Hermes */}
        {prompt && (
          <div className="my-2.5 rounded-xl bg-slate-950/70 border border-violet-500/15 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-violet-300/80 mb-1">
              <Terminal className="w-3 h-3" />
              <span>FRIDAY sent to Hermes</span>
            </div>
            <div className="text-xs leading-relaxed whitespace-pre-wrap text-slate-200">{prompt}</div>
          </div>
        )}

        {/* Hermes answer */}
        <div className="my-2.5 text-xs leading-relaxed whitespace-pre-wrap text-slate-200 max-h-72 overflow-y-auto pr-1">
          {text || 'No response'}
        </div>

        <div className="flex items-center justify-between gap-2 mt-2 text-[10px] font-mono text-violet-300/70">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            <span>Routed via Hermes • full capabilities</span>
          </div>
          {sessionId && (
            <span
              className="px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300/80"
              title="Hermes session id — open with: hermes chat --resume <id>"
            >
              {sessionId.slice(0, 14)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 6. Obsidian Note Card
  if (type === 'obsidian_note') {
    const { path: notePath, content } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-amber-950/30 to-slate-900/95 border border-amber-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-amber-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-300">Obsidian Vault</span>
              <h3 className="text-xs text-slate-300">{title}</h3>
              {notePath && <p className="text-[10px] font-mono text-slate-500">{notePath}</p>}
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {content && (
          <div className="my-2.5 p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/30 text-xs whitespace-pre-wrap max-h-56 overflow-y-auto">
            {content.slice(0, 3000)}
          </div>
        )}
      </div>
    );
  }

  // 7. Obsidian Search Results
  if (type === 'obsidian_search') {
    const { query, results = [] } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-slate-800/50 to-slate-900/95 border border-slate-600/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-600/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-slate-700/60 text-slate-300">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">Vault Search</span>
              <h3 className="text-xs text-slate-400">“{query}” • {results.length} result{results.length === 1 ? '' : 's'}</h3>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="space-y-2 my-2.5 max-h-64 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-3">No notes matched “{query}”.</p>
          ) : (
            results.map((r: any, i: number) => (
              <div key={i} className="p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:bg-slate-800/60 transition-colors">
                <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <FilePlus className="w-3 h-3" /> {r.file}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{r.snippet}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // 8. Prime Agent Coding & Software Engineering Response Card
  if (type === 'prime_response') {
    const { text, prompt, codeSnippets = [] } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-indigo-950/40 to-slate-900/95 border border-indigo-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-indigo-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-indigo-300">
                Prime Agent • Coding & Engineering
              </span>
              <h3 className="text-xs text-slate-300 truncate max-w-xs" title={title}>
                {title}
              </h3>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {prompt && (
          <div className="my-2.5 rounded-xl bg-slate-950/70 border border-indigo-500/15 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-indigo-300/80 mb-1">
              <Terminal className="w-3 h-3" />
              <span>Prompt / Specification</span>
            </div>
            <div className="text-xs leading-relaxed whitespace-pre-wrap text-slate-200">{prompt}</div>
          </div>
        )}

        <div className="my-2.5 text-xs leading-relaxed whitespace-pre-wrap text-slate-200 max-h-72 overflow-y-auto pr-1 font-mono">
          {text || 'No code returned'}
        </div>

        <div className="flex items-center justify-between gap-2 mt-2 text-[10px] font-mono text-indigo-300/70">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-indigo-400" />
            <span>Executed via Prime Agent RLM Harness</span>
          </div>
          {codeSnippets.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300/80">
              {codeSnippets.length} Code Block{codeSnippets.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 9. Ultron Deep OS Awareness & Audit Card
  if (type === 'ultron_audit') {
    const { healthScore = 100, overallStatus = 'optimal', summary, telemetry = {}, bottlenecks = [], recommendations = [] } = data || {};
    const statusColor = overallStatus === 'optimal' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : overallStatus === 'warning' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : 'text-red-400 border-red-500/30 bg-red-500/10';

    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-red-950/40 to-slate-900/95 border border-red-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-red-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-red-500/20 text-red-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-red-300">
                Ultron • Chief Security & System Architect
              </span>
              <h3 className="text-xs text-slate-300 truncate max-w-xs">{title}</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
              SCORE {healthScore}/100 • {overallStatus.toUpperCase()}
            </span>
            {onDismiss && (
              <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Telemetry quick strip */}
        <div className="grid grid-cols-3 gap-2 my-3 font-mono text-center">
          <div className="p-2 rounded-xl bg-slate-950/60 border border-red-500/15">
            <div className="text-[10px] text-slate-400">CPU LOAD</div>
            <div className="text-sm font-bold text-red-300 mt-0.5">{telemetry.cpuPercent?.toFixed?.(1) ?? telemetry.cpuPercent ?? '0'}%</div>
          </div>
          <div className="p-2 rounded-xl bg-slate-950/60 border border-red-500/15">
            <div className="text-[10px] text-slate-400">RAM USAGE</div>
            <div className="text-sm font-bold text-red-300 mt-0.5">{telemetry.ramPercent?.toFixed?.(1) ?? telemetry.ramPercent ?? '0'}%</div>
          </div>
          <div className="p-2 rounded-xl bg-slate-950/60 border border-red-500/15">
            <div className="text-[10px] text-slate-400">MAX TEMP</div>
            <div className="text-sm font-bold text-red-300 mt-0.5">{telemetry.maxTempCelsius ?? 0}°C</div>
          </div>
        </div>

        {summary && <div className="text-xs text-slate-300 my-2 leading-relaxed">{summary}</div>}

        {bottlenecks.length > 0 && (
          <div className="my-2 p-2.5 rounded-xl bg-red-950/30 border border-red-500/20">
            <div className="text-[10px] font-mono uppercase text-red-300 font-semibold mb-1">Detected Bottlenecks:</div>
            <ul className="text-xs text-red-200/90 space-y-0.5 list-disc list-inside">
              {bottlenecks.map((b: string, i: number) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // 10. Ultron Boost Result Card
  if (type === 'ultron_boost') {
    const { freedRamMb = 0, powerProfileSet = 'performance', optimizationsApplied = [], afterRamPercent = 0, summary } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-rose-950/40 to-slate-900/95 border border-rose-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-rose-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-rose-300">
                Ultron • System Performance Boost
              </span>
              <h3 className="text-xs text-slate-300">{title}</h3>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 my-3 font-mono">
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-rose-500/20 text-center">
            <div className="text-[10px] text-slate-400">FREED MEMORY</div>
            <div className="text-base font-bold text-emerald-400 mt-0.5">+{freedRamMb} MB</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-rose-500/20 text-center">
            <div className="text-[10px] text-slate-400">POWER GOVERNOR</div>
            <div className="text-base font-bold text-rose-300 uppercase mt-0.5">{powerProfileSet}</div>
          </div>
        </div>

        {optimizationsApplied.length > 0 && (
          <div className="space-y-1 my-2">
            {optimizationsApplied.map((opt: string, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs text-slate-200">
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>{opt}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 11. Friday Live Telemetry Card
  if (type === 'system_telemetry') {
    const { cpu, ramPct, ramUsed, ramTotal, temp, batt } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-cyan-950/40 to-slate-900/95 border border-cyan-500/30 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-cyan-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-300">
                Friday • Real-Time OS Telemetry
              </span>
              <h3 className="text-xs text-slate-300">{title}</h3>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3 font-mono text-center">
          <div className="p-2 rounded-xl bg-slate-950/60 border border-cyan-500/15">
            <div className="text-[10px] text-slate-400">CPU LOAD</div>
            <div className="text-sm font-bold text-cyan-300 mt-0.5">{cpu || '0%'}</div>
          </div>
          <div className="p-2 rounded-xl bg-slate-950/60 border border-cyan-500/15">
            <div className="text-[10px] text-slate-400">RAM USAGE</div>
            <div className="text-sm font-bold text-cyan-300 mt-0.5">{ramPct || '0'}%</div>
          </div>
          <div className="p-2 rounded-xl bg-slate-950/60 border border-cyan-500/15">
            <div className="text-[10px] text-slate-400">THERMALS</div>
            <div className="text-sm font-bold text-cyan-300 mt-0.5">{temp || 'Normal'}</div>
          </div>
          <div className="p-2 rounded-xl bg-slate-950/60 border border-cyan-500/15">
            <div className="text-[10px] text-slate-400">BATTERY</div>
            <div className="text-sm font-bold text-cyan-300 mt-0.5">{batt || 'AC'}</div>
          </div>
        </div>
      </div>
    );
  }

  // 12. Friday Instant System Control Card
  if (type === 'system_control') {
    const { percent, profile, action: act, command, message } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-teal-950/40 to-slate-900/95 border border-teal-500/30 p-3.5 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-teal-500/20 text-teal-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-teal-300">
                Friday • System Actuation
              </span>
              <h3 className="text-xs text-white font-medium">{title}</h3>
            </div>
          </div>
          <div className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
            {percent || profile || command || act || 'OK'}
          </div>
        </div>
      </div>
    );
  }

  // 13. Daily Personal Agenda & Priorities Card
  if (type === 'agenda_card') {
    const { activeReminders = [], schedule = [], totalActive = 0, battery, telemetry } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-cyan-950/40 to-slate-900/95 border border-cyan-500/40 p-4 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between pb-2.5 border-b border-cyan-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-300">
                Friday • Personal AI Manager
              </span>
              <h3 className="text-xs text-white font-medium">{title}</h3>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Schedule & Priorities List */}
        <div className="my-3 space-y-2 max-h-60 overflow-y-auto pr-1">
          {schedule.length === 0 && activeReminders.length === 0 ? (
            <div className="p-3 text-center rounded-xl bg-slate-950/50 border border-slate-800 text-xs text-slate-400 font-mono">
              ✨ No pending schedule items. Specialist fleet is standing by for new tasks!
            </div>
          ) : (
            <>
              {schedule.map((item: any) => (
                <div key={item.id} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white truncate">{item.title}</span>
                      {item.assignedAgent && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-mono">
                          {item.assignedAgent}
                        </span>
                      )}
                    </div>
                    {item.time && <div className="text-[10px] text-cyan-300/80 font-mono mt-0.5">{item.time}</div>}
                  </div>
                  {item.completed ? (
                    <span className="text-[10px] text-emerald-400 font-mono">Completed</span>
                  ) : (
                    <span className="text-[10px] text-amber-300 font-mono">Pending</span>
                  )}
                </div>
              ))}

              {activeReminders.map((rem: any) => (
                <div key={rem.id} className="p-2.5 rounded-xl bg-slate-950/70 border border-amber-500/20 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-amber-200">{rem.text}</div>
                    <div className="text-[10px] text-slate-400 font-mono">Due {rem.dueDateString}</div>
                  </div>
                  <span className="text-[10px] text-amber-400 font-mono">Reminder</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-cyan-300/70 pt-2 border-t border-cyan-500/20">
          <span>Priority Count: {totalActive || (schedule.length + activeReminders.length)}</span>
          <span>Fleet: Prime Agent • Hermes • Ultron</span>
        </div>
      </div>
    );
  }

  // 14. Schedule Updated Card
  if (type === 'schedule_updated') {
    const { title: itemTitle, time: itemTime, priority, assignedAgent } = data || {};
    return (
      <div className="w-full max-w-xl mx-auto my-3 rounded-2xl bg-gradient-to-br from-slate-900/95 via-indigo-950/40 to-slate-900/95 border border-indigo-500/30 p-3.5 text-slate-100 shadow-xl backdrop-blur-md animate-fadeIn">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-indigo-300">
                Schedule Updated
              </span>
              <h3 className="text-xs text-white font-medium">{itemTitle || title}</h3>
            </div>
          </div>
          {assignedAgent && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-500/40 text-indigo-300">
              {assignedAgent}
            </span>
          )}
        </div>
      </div>
    );
  }

  return null;
};
