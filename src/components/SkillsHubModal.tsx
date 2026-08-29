import React from 'react';
import { ModularSkillInfo } from '../types';
import {
  Sparkles,
  CloudSun,
  Newspaper,
  Bell,
  Calculator,
  Camera,
  Layers,
  X,
  Play,
  ArrowRight,
} from 'lucide-react';

interface SkillsHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunPrompt: (prompt: string) => void;
}

const MODULAR_SKILLS_LIST: ModularSkillInfo[] = [
  {
    name: 'get_weather_forecast',
    displayName: 'Live Weather & Forecasts',
    description:
      'Real-time atmospheric conditions, temperatures, humidity, wind, and 3-day forecasts for any city or region worldwide.',
    category: 'Weather',
    icon: 'CloudSun',
    samplePrompts: [
      "What's the weather in Tokyo right now?",
      "Will it rain in London today?",
      'What is the 3-day forecast for New York in Fahrenheit?',
    ],
  },
  {
    name: 'get_news_headlines',
    displayName: 'Live Breaking News',
    description:
      'Real-time top stories, technology updates, business, science, AI, and sports news headlines with live sources.',
    category: 'News',
    icon: 'Newspaper',
    samplePrompts: [
      'What are the latest technology headlines?',
      'Give me the top world news stories today',
      'What is happening in AI news right now?',
    ],
  },
  {
    name: 'manage_reminders',
    displayName: 'Smart Reminders & Alarms',
    description:
      'Schedule tasks, alarms, and timers with natural language durations. Receives live in-app audio chimes and visual alerts.',
    category: 'Productivity',
    icon: 'Bell',
    samplePrompts: [
      'Remind me in 5 minutes to check the server logs',
      'What are my active reminders?',
      'Set a reminder to submit the report in 15 minutes',
    ],
  },
  {
    name: 'calculate_or_convert',
    displayName: 'Precision Math & Unit Converter',
    description:
      'Instant arithmetic computations, percentages, metric/imperial conversions, and temperature conversions.',
    category: 'Utility',
    icon: 'Calculator',
    samplePrompts: [
      'What is 15% of 850?',
      'Convert 75 miles to kilometers',
      'What is 28 Celsius in Fahrenheit?',
    ],
  },
  {
    name: 'toggle_vision',
    displayName: 'Vision & Screen Intelligence',
    description:
      'Live camera and screen sharing perception with front/rear camera flipping and visual analysis.',
    category: 'System',
    icon: 'Camera',
    samplePrompts: [
      'Look at my screen and explain this code',
      'Turn on the camera',
      'Flip to the rear camera',
    ],
  },
];

export const SkillsHubModal: React.FC<SkillsHubModalProps> = ({
  isOpen,
  onClose,
  onRunPrompt,
}) => {
  if (!isOpen) return null;

  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'CloudSun':
        return <CloudSun className="w-5 h-5 text-sky-400" />;
      case 'Newspaper':
        return <Newspaper className="w-5 h-5 text-indigo-400" />;
      case 'Bell':
        return <Bell className="w-5 h-5 text-amber-400" />;
      case 'Calculator':
        return <Calculator className="w-5 h-5 text-emerald-400" />;
      case 'Camera':
        return <Camera className="w-5 h-5 text-cyan-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-cyan-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl p-5 sm:p-6 text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">Modular Skills System</h2>
              <p className="text-xs text-slate-400">
                Integrated real-time APIs & natural language voice commands
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Skills Cards List */}
        <div className="flex-1 overflow-y-auto my-4 space-y-3 pr-1">
          {MODULAR_SKILLS_LIST.map((skill) => (
            <div
              key={skill.name}
              className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 hover:border-cyan-500/30 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-800 border border-slate-700 mt-0.5">
                    {renderIcon(skill.icon)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{skill.displayName}</h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">
                        {skill.category}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{skill.description}</p>
                  </div>
                </div>
              </div>

              {/* Sample Voice Prompts */}
              {skill.samplePrompts && skill.samplePrompts.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-700/40">
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5">
                    Try Saying:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {skill.samplePrompts.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          onRunPrompt(prompt);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-cyan-950 hover:text-cyan-200 border border-slate-700 hover:border-cyan-500/50 text-[11px] text-slate-300 font-mono transition-colors text-left"
                      >
                        <Play className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
                        <span>"{prompt}"</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>All skills execute automatically in real-time voice sessions.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
