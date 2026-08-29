import React, { useState } from 'react';
import { ReminderItem } from '../types';
import {
  Bell,
  Clock,
  CheckCircle2,
  Trash2,
  Plus,
  X,
  AlertCircle,
} from 'lucide-react';

interface RemindersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  reminders: ReminderItem[];
  onCreateReminder: (text: string, minutes: number) => void;
  onCompleteReminder: (id: string) => void;
  onDeleteReminder: (id: string) => void;
}

export const RemindersDrawer: React.FC<RemindersDrawerProps> = ({
  isOpen,
  onClose,
  reminders,
  onCreateReminder,
  onCompleteReminder,
  onDeleteReminder,
}) => {
  const [newText, setNewText] = useState('');
  const [newMinutes, setNewMinutes] = useState(5);

  if (!isOpen) return null;

  const activeReminders = reminders.filter((r) => !r.completed);
  const completedReminders = reminders.filter((r) => r.completed);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    onCreateReminder(newText.trim(), Number(newMinutes) || 5);
    setNewText('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-5 text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Smart Reminders</h2>
              <p className="text-xs text-slate-400">
                {activeReminders.length} active reminder{activeReminders.length === 1 ? '' : 's'}
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

        {/* Quick Add Form */}
        <form onSubmit={handleSubmit} className="my-4 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            <span>Create New Reminder</span>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="e.g. Turn off the oven, Call dentist..."
              className="w-full px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Due in:</span>
                <select
                  value={newMinutes}
                  onChange={(e) => setNewMinutes(Number(e.target.value))}
                  className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-amber-400"
                >
                  <option value={1}>1 min</option>
                  <option value={5}>5 mins</option>
                  <option value={10}>10 mins</option>
                  <option value={15}>15 mins</option>
                  <option value={30}>30 mins</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={!newText.trim()}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors disabled:opacity-40"
              >
                Set Reminder
              </button>
            </div>
          </div>
        </form>

        {/* Reminders List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {activeReminders.length === 0 && completedReminders.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40 text-amber-400" />
              <p className="text-xs">No reminders scheduled.</p>
              <p className="text-[11px] mt-1 text-slate-400">
                You can say <strong className="text-slate-300">"Remind me in 10 minutes to..."</strong>
              </p>
            </div>
          )}

          {activeReminders.map((rem) => {
            const timeLeftMs = rem.dueAt - Date.now();
            const minutesLeft = Math.max(0, Math.ceil(timeLeftMs / 60000));

            return (
              <div
                key={rem.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-amber-500/20 hover:border-amber-500/40 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white truncate">{rem.text}</div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-amber-300/90">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {rem.dueDateString}
                    </span>
                    <span>•</span>
                    <span>
                      {timeLeftMs <= 0
                        ? 'Due Now!'
                        : `${minutesLeft} min${minutesLeft === 1 ? '' : 's'} left`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onCompleteReminder(rem.id)}
                    className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-lg hover:bg-slate-700/60 transition-colors"
                    title="Mark Done"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDeleteReminder(rem.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-700/60 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Completed section */}
          {completedReminders.length > 0 && (
            <div className="pt-3 mt-2 border-t border-slate-800/80">
              <div className="text-[11px] font-mono uppercase text-slate-500 mb-1.5 px-1">
                Completed ({completedReminders.length})
              </div>
              <div className="space-y-1.5 opacity-60">
                {completedReminders.slice(-3).map((rem) => (
                  <div
                    key={rem.id}
                    className="p-2 rounded-lg bg-slate-800/20 border border-slate-800 flex items-center justify-between text-xs line-through text-slate-400"
                  >
                    <span className="truncate">{rem.text}</span>
                    <button
                      onClick={() => onDeleteReminder(rem.id)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="pt-3 mt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <span>Voice trigger: "Remind me in..."</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
