import React, { useState } from 'react';
import { Send, Globe, Sparkles, Mic } from 'lucide-react';

interface ManualTextInputProps {
  onSendText: (text: string, useSearch?: boolean) => void;
  disabled?: boolean;
  isConnected: boolean;
}

export const ManualTextInput: React.FC<ManualTextInputProps> = ({
  onSendText,
  disabled = false,
  isConnected,
}) => {
  const [text, setText] = useState('');
  const [useSearch, setUseSearch] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSendText(text.trim(), useSearch);
    setText('');
  };

  return (
    <form
      id="manual-text-input-form"
      onSubmit={handleSubmit}
      className="flex items-center gap-2 p-2 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md shadow-lg"
    >
      {/* Search Grounding toggle */}
      <button
        type="button"
        id="toggle-search-grounding-btn"
        onClick={() => setUseSearch(!useSearch)}
        className={`px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors border ${
          useSearch
            ? 'bg-indigo-950 text-indigo-300 border-indigo-700/80 shadow-sm'
            : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-slate-200'
        }`}
        title="Toggle Real-Time Google Search Grounding"
      >
        <Globe className={`w-3.5 h-3.5 ${useSearch ? 'text-indigo-400' : 'text-slate-400'}`} />
        <span className="hidden sm:inline font-medium text-[11px]">Search</span>
      </button>

      {/* Input */}
      <input
        type="text"
        id="verbal-text-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        placeholder={
          isConnected
            ? 'Type a question or talk naturally into your microphone...'
            : 'Connect microphone above or type a question here...'
        }
        className="flex-1 px-3 py-2 text-xs sm:text-sm bg-transparent text-slate-100 placeholder-slate-400 focus:outline-none disabled:opacity-50"
      />

      {/* Send Button */}
      <button
        type="submit"
        id="send-text-prompt-btn"
        disabled={!text.trim() || disabled}
        className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md disabled:opacity-40 disabled:pointer-events-none"
      >
        <span>Send</span>
        <Send className="w-3.5 h-3.5" />
      </button>
    </form>
  );
};
