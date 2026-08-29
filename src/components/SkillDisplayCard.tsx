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
    const { text } = data || {};
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
              <h3 className="text-xs text-slate-300 truncate max-w-xs">{title}</h3>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="my-2.5 text-xs leading-relaxed whitespace-pre-wrap text-slate-200 max-h-72 overflow-y-auto pr-1">
          {text || 'No response'}
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono text-violet-300/70">
          <Sparkles className="w-3 h-3" />
          <span>Routed via Hermes • memory, vault, tools, system — full capabilities</span>
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

  return null;
};
