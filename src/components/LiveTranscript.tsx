import React, { useEffect, useRef, useState } from 'react';
import { TranscriptItem, AgentStatus } from '../types';
import { Bot, User, Sparkles, Copy, Check, Trash2, ArrowDown, Activity } from 'lucide-react';

interface LiveTranscriptProps {
  items: TranscriptItem[];
  currentPartialAgentText: string;
  status: AgentStatus;
  onClear: () => void;
  voiceName: string;
}

export const LiveTranscript: React.FC<LiveTranscriptProps> = ({
  items,
  currentPartialAgentText,
  status,
  onClear,
  voiceName,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [items, currentPartialAgentText, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - (scrollTop + clientHeight) < 60;
    setAutoScroll(isNearBottom);
  };

  const handleCopyTranscript = async () => {
    if (items.length === 0) return;
    const text = items
      .map((item) => `[${new Date(item.timestamp).toLocaleTimeString()}] ${item.role.toUpperCase()}: ${item.text}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  return (
    <div
      id="live-transcript-card"
      className="flex flex-col h-full bg-slate-900/80 border border-slate-800 rounded-2xl backdrop-blur-md overflow-hidden shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/40">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
            Live Stream Dialogue
          </span>
          <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 rounded-full">
            {voiceName} Engine
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            id="copy-transcript-btn"
            onClick={handleCopyTranscript}
            disabled={items.length === 0}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
            title="Copy conversation transcript"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            id="clear-transcript-btn"
            onClick={onClear}
            disabled={items.length === 0}
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
            title="Clear transcript"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div
        id="transcript-messages-container"
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 p-4 overflow-y-auto space-y-4 scroll-smooth min-h-[220px]"
      >
        {items.length === 0 && !currentPartialAgentText ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-10 px-4 text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-indigo-950/50 border border-indigo-800/40 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-indigo-400" />
            </div>
            <p className="text-sm font-medium text-slate-300 mb-1">Aetheria Voice Ready</p>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              Press the Connect button or start speaking to initiate realtime speech-to-speech voice synthesis.
            </p>
          </div>
        ) : (
          <>
            {items.map((item) => {
              const isUser = item.role === 'user';
              const isSystem = item.role === 'system';

              if (isSystem) {
                return (
                  <div key={item.id} className="flex justify-center my-2">
                    <span className="px-3 py-1 text-[11px] bg-slate-800/80 text-slate-400 rounded-full border border-slate-700/50">
                      {item.text}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  className={`flex gap-3 text-sm ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div
                    className={`w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs font-semibold shadow-sm ${
                      isUser
                        ? 'bg-teal-600 text-teal-50'
                        : 'bg-indigo-600 text-indigo-50'
                    }`}
                  >
                    {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  <div
                    className={`flex flex-col max-w-[82%] ${
                      isUser ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <span className="text-[11px] font-medium text-slate-400">
                        {isUser ? 'You' : `Aetheria (${voiceName})`}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(item.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      {item.latencyMs && (
                        <span className="px-1.5 py-0.2 text-[9px] font-mono bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded">
                          {item.latencyMs}ms
                        </span>
                      )}
                      {item.isFiller && (
                        <span className="px-1.5 py-0.2 text-[9px] font-mono bg-amber-950/70 border border-amber-700/60 text-amber-300 rounded flex items-center gap-1">
                          <Activity className="w-2.5 h-2.5" />
                          Reactive Filler
                        </span>
                      )}
                    </div>

                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        isUser
                          ? 'bg-teal-950/60 text-teal-100 border border-teal-800/60 rounded-tr-sm'
                          : item.isFiller
                          ? 'bg-amber-950/40 text-amber-100 border border-amber-800/50 rounded-tl-sm italic'
                          : 'bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-tl-sm shadow-sm'
                      }`}
                    >
                      {item.text}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Current partial streaming text */}
            {currentPartialAgentText && (
              <div className="flex gap-3 text-sm flex-row">
                <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs font-semibold bg-indigo-600 text-indigo-50 shadow-sm animate-pulse">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="flex flex-col max-w-[82%] items-start">
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-[11px] font-medium text-indigo-300">
                      Aetheria (Speaking...)
                    </span>
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                  </div>
                  <div className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed bg-indigo-950/50 text-indigo-100 border border-indigo-700/60 rounded-tl-sm shadow-sm">
                    {currentPartialAgentText}
                    <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-indigo-400 animate-pulse" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Auto-scroll button if user scrolled up */}
      {!autoScroll && (
        <div className="relative">
          <button
            onClick={() => {
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight;
                setAutoScroll(true);
              }
            }}
            className="absolute bottom-2 right-4 px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg flex items-center gap-1.5 transition-all animate-bounce"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Scroll to live
          </button>
        </div>
      )}
    </div>
  );
};
