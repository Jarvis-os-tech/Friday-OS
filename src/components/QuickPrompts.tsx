import React from 'react';
import { QuickTopic } from '../types';
import { Zap, Brain, Sparkles, Compass, Lightbulb, Flame } from 'lucide-react';

interface QuickPromptsProps {
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

const QUICK_TOPICS: QuickTopic[] = [
  {
    id: '1',
    category: 'Speed Test',
    title: 'Flash Speed Test',
    prompt: 'Give me a rapid-fire lightning breakdown of why the sky is blue and why sunsets are red.',
    description: 'Ultra-fast flash vocal response with zero delay.',
    expectedComplexity: 'Instant Flash',
  },
  {
    id: '2',
    category: 'Intelligence',
    title: 'Cognitive Puzzle',
    prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Explain step by step.',
    description: 'Demonstrates deep reasoning with immediate verbalization.',
    expectedComplexity: 'Reasoning + Parallel Filter',
  },
  {
    id: '3',
    category: 'Science & Math',
    title: 'Quantum Entanglement',
    prompt: 'Explain quantum entanglement and Einstein\'s spooky action at a distance with an engaging everyday analogy.',
    description: 'Synthesizes deep physical principles into friendly spoken language.',
    expectedComplexity: 'Deep Synthesis',
  },
  {
    id: '4',
    category: 'Brainstorming',
    title: 'Unconventional Startup',
    prompt: 'Brainstorm three radical, high-impact technologies for autonomous atmospheric carbon capture.',
    description: 'Creative multi-step ideation with structured speech prosody.',
    expectedComplexity: 'Deep Synthesis',
  },
  {
    id: '5',
    category: 'Creative',
    title: 'Spontaneous Storytelling',
    prompt: 'Narrate a dramatic, humorous 30-second mini-story about an AI agent discovering coffee for the first time.',
    description: 'Rich tonal prosody, pacing, and human vocal inflection.',
    expectedComplexity: 'Instant Flash',
  },
  {
    id: '6',
    category: 'Casual',
    title: 'Philosophical Dilemma',
    prompt: 'If an AI system creates a painting entirely of its own volition, where does the artistic intent reside?',
    description: 'Thoughtful conversational exploration.',
    expectedComplexity: 'Reasoning + Parallel Filter',
  },
];

export const QuickPrompts: React.FC<QuickPromptsProps> = ({
  onSelectPrompt,
  disabled = false,
}) => {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Speed Test':
        return <Zap className="w-3.5 h-3.5 text-amber-400" />;
      case 'Intelligence':
        return <Brain className="w-3.5 h-3.5 text-indigo-400" />;
      case 'Science & Math':
        return <Compass className="w-3.5 h-3.5 text-cyan-400" />;
      case 'Brainstorming':
        return <Lightbulb className="w-3.5 h-3.5 text-emerald-400" />;
      case 'Creative':
        return <Sparkles className="w-3.5 h-3.5 text-pink-400" />;
      default:
        return <Flame className="w-3.5 h-3.5 text-violet-400" />;
    }
  };

  return (
    <div id="quick-prompts-section" className="w-full">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Interactive Verbal Topics
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          Click any card to prompt Aetheria aloud
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {QUICK_TOPICS.map((topic) => (
          <button
            key={topic.id}
            id={`quick-topic-${topic.id}`}
            onClick={() => onSelectPrompt(topic.prompt)}
            disabled={disabled}
            className="group text-left p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/90 border border-slate-800 hover:border-indigo-500/50 transition-all duration-200 shadow-sm flex flex-col justify-between disabled:opacity-50 disabled:pointer-events-none"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  {getCategoryIcon(topic.category)}
                  <span className="text-[11px] font-medium text-slate-400">
                    {topic.category}
                  </span>
                </div>
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-mono rounded-full border ${
                    topic.expectedComplexity === 'Instant Flash'
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                      : topic.expectedComplexity === 'Reasoning + Parallel Filter'
                      ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                      : 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60'
                  }`}
                >
                  {topic.expectedComplexity}
                </span>
              </div>

              <h4 className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors mb-1">
                {topic.title}
              </h4>
              <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                "{topic.prompt}"
              </p>
            </div>

            <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400 group-hover:text-indigo-300">
              <span>{topic.description}</span>
              <span className="font-semibold group-hover:translate-x-0.5 transition-transform">
                Speak →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
