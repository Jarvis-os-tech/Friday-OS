import React from 'react';
import { Globe, ExternalLink, Sparkles, Compass, CheckCircle2, Search } from 'lucide-react';
import { GroundingSource } from '../types';

interface AutoResearchCardProps {
  isSearching: boolean;
  matchedKeywords?: string[];
  sources?: GroundingSource[];
  onSourceClick?: (source: GroundingSource) => void;
}

export const AutoResearchCard: React.FC<AutoResearchCardProps> = ({
  isSearching,
  matchedKeywords = [],
  sources = [],
}) => {
  if (!isSearching && sources.length === 0 && matchedKeywords.length === 0) {
    return null;
  }

  return (
    <div
      id="auto-research-status-card"
      className="w-full p-2 transition-all animate-fadeIn"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          {isSearching ? (
            <Compass className="w-3.5 h-3.5 animate-spin text-cyan-400" />
          ) : (
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
          )}
          <span className="font-mono text-slate-300">
            {isSearching
              ? 'Searching web intelligence...'
              : `${sources.length} source${sources.length === 1 ? '' : 's'} grounded`}
          </span>
        </div>

        {/* Matched Keywords Tags */}
        {matchedKeywords.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end">
            {matchedKeywords.slice(0, 3).map((kw, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-full bg-slate-900 text-[10px] font-mono text-cyan-300"
              >
                "{kw}"
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sources Grid */}
      {sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 max-h-32 overflow-y-auto">
          {sources.map((source, index) => (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              id={`grounding-source-link-${index}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-200 text-xs transition-colors"
            >
              <Globe className="w-3 h-3 text-cyan-400" />
              <span className="truncate max-w-[150px] font-mono">
                {source.title || source.domain || 'Web Source'}
              </span>
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};
