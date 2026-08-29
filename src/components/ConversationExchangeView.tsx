import React from 'react';
import {
  Sparkles,
  User,
  Volume2,
  FileText,
  Folder,
  Link as LinkIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  Globe,
  ExternalLink,
  Search,
  CheckCircle2,
  Zap,
  Brain,
  Scale,
} from 'lucide-react';
import { MessageExchange, InputAttachment, GroundingSource } from '../types';

interface ConversationExchangeViewProps {
  messages: MessageExchange[];
  onPreviewAttachment?: (attachment: InputAttachment) => void;
  onPlayAudio?: (text: string) => void;
}

export const ConversationExchangeView: React.FC<ConversationExchangeViewProps> = ({
  messages,
  onPreviewAttachment,
  onPlayAudio,
}) => {
  if (messages.length === 0) return null;

  return (
    <div
      id="conversation-exchange-feed"
      className="w-full space-y-4 max-h-[480px] overflow-y-auto pr-1 pb-2"
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 animate-fadeIn ${
            msg.role === 'user' ? 'justify-end' : 'justify-start'
          }`}
        >
          {msg.role === 'agent' && (
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md flex-shrink-0 mt-1">
              <Sparkles className="w-4 h-4" />
            </div>
          )}

          <div
            className={`max-w-[85%] sm:max-w-[78%] rounded-2xl p-4 transition-all shadow-md ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-tr-sm ml-auto'
                : 'bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-sm backdrop-blur-md'
            }`}
          >
            {/* Auto-detected Processing Tier Header Badge for Agent */}
            {msg.role === 'agent' && msg.tier && (
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800/60">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                    msg.tier.id === 'ultra_fast'
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                      : msg.tier.id === 'direct_fast'
                      ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                      : 'bg-amber-950/80 text-amber-300 border-amber-700/60'
                  }`}
                  title={msg.tier.reason}
                >
                  {msg.tier.id === 'ultra_fast' && <Zap className="w-2.5 h-2.5 text-emerald-400" />}
                  {msg.tier.id === 'direct_fast' && <Brain className="w-2.5 h-2.5 text-indigo-400" />}
                  {msg.tier.id === 'balanced' && <Scale className="w-2.5 h-2.5 text-amber-400" />}
                  <span>{msg.tier.name}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {msg.tier.reason}
                </span>
              </div>
            )}

            {/* User Attachments Preview */}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {msg.attachments.map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => onPreviewAttachment && onPreviewAttachment(att)}
                    className={`flex items-center gap-2 p-1.5 pr-2.5 rounded-xl text-xs transition-colors text-left ${
                      msg.role === 'user'
                        ? 'bg-indigo-700/80 hover:bg-indigo-800 text-white border border-indigo-500/40'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-700'
                    }`}
                  >
                    {att.type === 'image' && att.previewUrl ? (
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="w-6 h-6 rounded-md object-cover"
                      />
                    ) : att.type === 'video' ? (
                      <VideoIcon className="w-4 h-4 text-purple-300" />
                    ) : att.type === 'folder' ? (
                      <Folder className="w-4 h-4 text-amber-300" />
                    ) : att.type === 'link' ? (
                      <LinkIcon className="w-4 h-4 text-sky-300" />
                    ) : (
                      <FileText className="w-4 h-4 text-slate-300" />
                    )}
                    <span className="truncate max-w-[140px] font-medium">
                      {att.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Message Body Text */}
            <div className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
              {msg.text}
            </div>

            {/* Auto Search Grounding & Citations Indicator */}
            {msg.sources && msg.sources.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Live Web Research Grounding:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {msg.sources.slice(0, 4).map((source, sIdx) => (
                    <a
                      key={sIdx}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/80 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/40 text-[11px] text-slate-300 transition-colors"
                    >
                      <Globe className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                      <span className="truncate flex-1 font-medium">{source.title || source.domain}</span>
                      <ExternalLink className="w-2.5 h-2.5 text-slate-400 flex-shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Agent Play Speech Button */}
            {msg.role === 'agent' && onPlayAudio && msg.text && (
              <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  type="button"
                  onClick={() => onPlayAudio(msg.text)}
                  className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-200 px-2 py-0.5 rounded-lg hover:bg-indigo-950/50 transition-colors"
                >
                  <Volume2 className="w-3 h-3" />
                  <span>Listen Voice</span>
                </button>
              </div>
            )}
          </div>

          {msg.role === 'user' && (
            <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-700/50 flex items-center justify-center text-indigo-300 shadow-md flex-shrink-0 mt-1">
              <User className="w-4 h-4" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
