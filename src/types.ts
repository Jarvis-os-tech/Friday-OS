export type ProcessingTierId = 'ultra_fast' | 'balanced' | 'direct_fast';

export interface ProcessingTier {
  id: ProcessingTierId;
  name: string;
  badge: string;
  description: string;
  reason: string;
  thinkingBudget: number;
  color: string;
}

export interface VoicePreset {
  id: string;
  name: string;
  gender: string;
  tone: string;
  description: string;
  badge?: string;
}

export type AgentStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export type AttachmentType =
  | 'link'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'code'
  | 'folder';

export interface FolderFileItem {
  path: string;
  name: string;
  size: number;
  content?: string;
  type: string;
}

export interface InputAttachment {
  id: string;
  type: AttachmentType;
  name: string;
  size?: number;
  mimeType: string;
  data?: string; // base64 or raw text
  previewUrl?: string; // blob or thumbnail
  url?: string; // web url if type === 'link'
  linkMetadata?: {
    title?: string;
    description?: string;
    domain?: string;
    favicon?: string;
  };
  folderFiles?: FolderFileItem[];
  folderName?: string;
  fileCount?: number;
}

export interface GroundingSource {
  title: string;
  url: string;
  snippet?: string;
  domain?: string;
}

export interface AutoResearchState {
  isSearching: boolean;
  query?: string;
  keywordsDetected: string[];
  sources: GroundingSource[];
  lastSearchedAt?: number;
}

export interface SkillDisplayCard {
  type:
    | 'weather'
    | 'news'
    | 'reminder_created'
    | 'reminders_list'
    | 'calculation'
    | 'hermes_response'
    | 'prime_response'
    | 'ultron_audit'
    | 'ultron_boost'
    | 'ultron_heal'
    | 'ultron_security'
    | 'system_telemetry'
    | 'system_control'
    | 'obsidian_note'
    | 'obsidian_search'
    | string;
  title: string;
  data: any;
}

export interface ModularSkillInfo {
  name: string;
  displayName: string;
  description: string;
  category: 'Weather' | 'News' | 'Productivity' | 'Utility' | 'System';
  icon: string;
  samplePrompts?: string[];
}

export interface ReminderItem {
  id: string;
  text: string;
  createdAt: number;
  dueAt: number;
  dueDateString: string;
  completed: boolean;
}

export interface MessageExchange {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
  attachments?: InputAttachment[];
  sources?: GroundingSource[];
  isAutoResearched?: boolean;
  tier?: ProcessingTier;
  audioUrl?: string;
  skillCard?: SkillDisplayCard;
}

export interface TranscriptItem {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: number;
  latencyMs?: number;
  isFiller?: boolean;
  isPartial?: boolean;
  attachments?: InputAttachment[];
  sources?: GroundingSource[];
}

export interface VoiceSettings {
  voiceName: string;
  fillerStyle: 'reactive_fillers' | 'standard' | 'minimal';
  noiseGateThreshold: number; // 0.001 to 0.1
  speechSpeed: number; // 0.8 to 1.3
  customContext: string;
  autoInterrupt: boolean;
  enhancedReasoning: boolean;
  hapticFeedback: boolean;
  autoSearchGrounding: boolean;
}

export interface TelemetryMetrics {
  roundTripLatencyMs: number;
  audioPacketsSent: number;
  audioPacketsReceived: number;
  micVolumeLevel: number;
  agentVolumeLevel: number;
  sampleRateIn: number;
  sampleRateOut: number;
  fillersUsedCount: number;
  sessionDurationSec: number;
  wsState: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
}

export interface QuickTopic {
  id: string;
  category: 'Intelligence' | 'Science & Math' | 'Brainstorming' | 'Casual' | 'Creative' | 'Speed Test';
  title: string;
  prompt: string;
  description: string;
  expectedComplexity: 'Instant Flash' | 'Reasoning + Parallel Filter' | 'Deep Synthesis';
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TaskCategory =
  | 'weather'
  | 'news'
  | 'research'
  | 'productivity'
  | 'hermes'
  | 'prime_agent'
  | 'ultron'
  | 'obsidian'
  | 'calculation'
  | 'data_fetch'
  | 'system';

export interface BackgroundTask {
  id: string;
  type: TaskCategory;
  title: string;
  prompt?: string;
  status: TaskStatus;
  startTime: number;
  completedTime?: number;
  durationMs?: number;
  progressPercent?: number;
  progressMessage?: string;
  verbalAcknowledgment?: string;
  speechSummary?: string;
  result?: any;
  displayCard?: SkillDisplayCard;
  sources?: GroundingSource[];
  error?: string;
}

export interface ParallelExecutionState {
  activeTasks: BackgroundTask[];
  completedTasks: BackgroundTask[];
  isProcessing: boolean;
  lastVerbalFeedback?: string;
}

export interface TaskProgressEvent {
  taskId: string;
  type: TaskCategory;
  title: string;
  progressMessage?: string;
  progressPercent?: number;
  status: TaskStatus;
  verbalAcknowledgment?: string;
  result?: any;
  displayCard?: SkillDisplayCard;
  durationMs?: number;
  error?: string;
}

