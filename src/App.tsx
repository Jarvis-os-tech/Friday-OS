import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AgentStatus,
  TranscriptItem,
  VoiceSettings,
  VoicePreset,
  TelemetryMetrics,
  InputAttachment,
  MessageExchange,
  AutoResearchState,
  GroundingSource,
  ProcessingTier,
  ReminderItem,
  SkillDisplayCard as SkillDisplayCardType,
  BackgroundTask,
} from './types';
import { AudioStreamer } from './utils/audioStreamer';
import { VoiceVisualizer } from './components/VoiceVisualizer';
import { MultiInputBar } from './components/MultiInputBar';
import { AutoResearchCard } from './components/AutoResearchCard';
import { AttachmentPreviewModal } from './components/AttachmentPreviewModal';
import { AudioSettingsModal } from './components/AudioSettingsModal';
import { LiveVisionPreview } from './components/LiveVisionPreview';
import { SkillDisplayCard } from './components/SkillDisplayCard';
import { RemindersDrawer } from './components/RemindersDrawer';
import { SkillsHubModal } from './components/SkillsHubModal';
import { ParallelTaskDock } from './components/ParallelTaskDock';
import { VerbalFeedbackEngine, getContextualVerbalPhrase } from './utils/verbalFeedback';
import { useVoiceControls } from './hooks/useVoiceControls';
import {
  Mic,
  MicOff,
  Power,
  Radio,
  SlidersHorizontal,
  Sparkles,
  StopCircle,
  Zap,
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Search,
  Layers,
  Brain,
  Scale,
  Camera,
  CameraOff,
  Monitor,
  MonitorOff,
  ExternalLink,
  RefreshCw,
  Bell,
  Check,
  Key,
  Bot,
} from 'lucide-react';

const DEFAULT_SETTINGS: VoiceSettings = {
  voiceName: 'Zephyr',
  fillerStyle: 'reactive_fillers',
  noiseGateThreshold: 0.006,
  speechSpeed: 1.0,
  customContext: '',
  autoInterrupt: true,
  enhancedReasoning: true,
  hapticFeedback: true,
  autoSearchGrounding: true,
};

const FILLER_TRIGGERS = [
  'let me check',
  'searching into',
  'on it',
  'looking at',
  'synthesizing',
  'one moment',
  'putting this together',
  'calculating that',
  'processing that',
  'taking a second',
];

export default function App() {
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [voices, setVoices] = useState<VoicePreset[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [currentTier, setCurrentTier] = useState<ProcessingTier>({
    id: 'ultra_fast',
    name: 'Ultra Fast',
    badge: '⚡ Ultra Fast',
    description: 'Instant sub-100ms conversational stream',
    reason: 'Autonomous speed routing ready',
    thinkingBudget: 0,
    color: 'emerald',
  });

  const [messages, setMessages] = useState<MessageExchange[]>([]);
  const [activeResearch, setActiveResearch] = useState<AutoResearchState>({
    isSearching: false,
    keywordsDetected: [],
    sources: [],
  });
  const [previewAttachment, setPreviewAttachment] = useState<InputAttachment | null>(null);

  const [currentPartialAgentText, setCurrentPartialAgentText] = useState('');
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(1.0);
  const [micVolumeLevel, setMicVolumeLevel] = useState(0);

  const [telemetry, setTelemetry] = useState<TelemetryMetrics>({
    roundTripLatencyMs: 0,
    audioPacketsSent: 0,
    audioPacketsReceived: 0,
    micVolumeLevel: 0,
    agentVolumeLevel: 0,
    sampleRateIn: 16000,
    sampleRateOut: 24000,
    fillersUsedCount: 0,
    sessionDurationSec: 0,
    wsState: 'disconnected',
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Modular Skills & Reminders state
  const [activeSkillCard, setActiveSkillCard] = useState<SkillDisplayCardType | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [dueReminderAlert, setDueReminderAlert] = useState<ReminderItem | null>(null);
  const [isRemindersOpen, setIsRemindersOpen] = useState(false);
  const [isSkillsModalOpen, setIsSkillsModalOpen] = useState(false);
  const notifiedRemindersRef = useRef<Set<string>>(new Set());

  // Parallel Execution & Background Tasks state
  const [activeTasks, setActiveTasks] = useState<BackgroundTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<BackgroundTask[]>([]);
  const [taskCompletedToast, setTaskCompletedToast] = useState<BackgroundTask | null>(null);

  // Hermes Gateway connection status (consumes /api/hermes/health)
  type HermesConnState = 'checking' | 'live' | 'cli' | 'offline';
  const [hermesConn, setHermesConn] = useState<HermesConnState>('checking');
  const fetchHermesHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes/health');
      if (!res.ok) {
        setHermesConn('offline');
        return;
      }
      const data = await res.json();
      if (data?.connected) setHermesConn('live');
      else if (data?.delegation === 'ready') setHermesConn('cli');
      else setHermesConn('offline');
    } catch (e) {
      setHermesConn('offline');
    }
  }, []);

  useEffect(() => {
    fetchHermesHealth();
    const id = setInterval(fetchHermesHealth, 30_000);
    return () => clearInterval(id);
  }, [fetchHermesHealth]);

  const fetchActiveTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (Array.isArray(data.activeTasks)) {
        setActiveTasks(data.activeTasks);
      }
      if (Array.isArray(data.completedTasks)) {
        setCompletedTasks(data.completedTasks);
      }
    } catch (e) {
      // Ignore background fetch error
    }
  }, []);

  useEffect(() => {
    fetchActiveTasks();
  }, [fetchActiveTasks]);

  const handleCancelTask = useCallback(async (taskId: string) => {
    setActiveTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel_task', taskId }));
    }
    try {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
    } catch (e) {}
  }, []);

  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  // Play pleasant two-tone reminder audio chime
  const playReminderChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }, []);

  // Fetch initial reminders from server
  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch('/api/reminders');
      const data = await res.json();
      if (Array.isArray(data.reminders)) {
        setReminders(data.reminders);
      }
    } catch (err) {
      console.warn('Failed to load reminders:', err);
    }
  }, []);

  useEffect(() => {
    fetchReminders();
  }, [fetchReminders]);

  // Check for due reminders every 2.5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const due = reminders.find(
        (r) => !r.completed && r.dueAt <= now && !notifiedRemindersRef.current.has(r.id)
      );
      if (due) {
        notifiedRemindersRef.current.add(due.id);
        setDueReminderAlert(due);
        playReminderChime();
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [reminders, playReminderChime]);

  // Create new reminder via REST
  const handleCreateReminder = async (text: string, minutes: number) => {
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', text, due_in_minutes: minutes }),
      });
      const data = await res.json();
      if (data.data) {
        setReminders((prev) => [...prev, data.data]);
        setActiveSkillCard(data.displayCard);
      }
    } catch (err) {
      console.error('Failed to create reminder:', err);
    }
  };

  // Complete reminder
  const handleCompleteReminder = async (id: string) => {
    try {
      await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', reminder_id: id }),
      });
      setReminders((prev) =>
        prev.map((r) => (r.id === id ? { ...r, completed: true } : r))
      );
      if (dueReminderAlert?.id === id) {
        setDueReminderAlert(null);
      }
    } catch (err) {
      console.error('Failed to complete reminder:', err);
    }
  };

  // Delete reminder
  const handleDeleteReminder = async (id: string) => {
    try {
      await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', reminder_id: id }),
      });
      setReminders((prev) => prev.filter((r) => r.id !== id));
      if (dueReminderAlert?.id === id) {
        setDueReminderAlert(null);
      }
    } catch (err) {
      console.error('Failed to delete reminder:', err);
    }
  };

  // References
  const wsRef = useRef<WebSocket | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<any>(null);
  const durationIntervalRef = useRef<any>(null);
  const settingsRef = useRef<VoiceSettings>(settings);
  settingsRef.current = settings;

  // 1. Camera Controls (supports desktop webcams, mobile front & rear cameras)
  const startCameraFeed = useCallback(async (targetFacing?: 'user' | 'environment') => {
    try {
      setVisionError(null);
      const chosenFacing = targetFacing || facingMode;
      if (targetFacing) {
        setFacingMode(targetFacing);
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
      }
      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
        setScreenStream(null);
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setVisionError('Camera access is not supported on this browser.');
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: chosenFacing === 'environment' ? { ideal: 'environment' } : 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (constraintErr) {
        // Fallback for standard webcams that don't support facingMode constraints
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      setCameraStream(stream);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'vision_source_changed', source: 'camera' }));
      }
    } catch (err: any) {
      console.warn('Camera access note:', err?.message || err);
      if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission') || err?.message?.includes('disallowed')) {
        setVisionError('Camera permission blocked in iframe sandbox. Open app in a new tab to enable camera access.');
      } else {
        setVisionError('Unable to access camera: ' + (err?.message || 'Check camera permissions.'));
      }
    }
  }, [cameraStream, screenStream, facingMode]);

  const toggleFacingMode = useCallback(() => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    startCameraFeed(nextFacing);
  }, [facingMode, startCameraFeed]);

  const stopCameraFeed = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'vision_source_changed', source: 'none' }));
    }
    setVisionError(null);
  }, [cameraStream]);

  // 2. Screen Share Controls
  const startScreenShare = useCallback(async () => {
    try {
      setVisionError(null);
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setVisionError('Screen sharing is not supported by your current browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      setScreenStream(stream);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'vision_source_changed', source: 'screen' }));
      }
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          setScreenStream(null);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'vision_source_changed', source: 'none' }));
          }
        };
      }
    } catch (err: any) {
      console.warn('Screen sharing note:', err?.message || err);
      if (err?.name === 'AbortError' || (err?.name === 'NotAllowedError' && err?.message?.toLowerCase().includes('user denied'))) {
        // User closed or cancelled the prompt
        setVisionError(null);
      } else if (err?.name !== 'AbortError') {
        setVisionError('Screen sharing: ' + (err?.message || 'Display capture cancelled.'));
      }
    }
  }, [cameraStream]);

  const requestScreenShare = useCallback(async () => {
    await startScreenShare();
  }, [startScreenShare]);

  const stopScreenShare = useCallback(() => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'vision_source_changed', source: 'none' }));
    }
    setVisionError(null);
  }, [screenStream]);

  // 3. Video Frame Sampler (~1 FPS streaming to WebSocket)
  useEffect(() => {
    if (!cameraStream && !screenStream) return;

    const isCam = Boolean(cameraStream);
    const activeStream = cameraStream || screenStream;
    const video = document.createElement('video');
    video.srcObject = activeStream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const interval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (!video.videoWidth || !video.videoHeight) return;

      canvas.width = 640;
      canvas.height = Math.round((640 * video.videoHeight) / video.videoWidth);

      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        const base64 = dataUrl.split(',')[1];
        if (base64) {
          wsRef.current.send(
            JSON.stringify({
              type: 'video',
              image: base64,
              source: isCam ? 'camera' : 'screen',
            })
          );
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      video.pause();
      video.srcObject = null;
    };
  }, [cameraStream, screenStream]);

  // Fetch voice presets on mount
  useEffect(() => {
    fetch('/api/voices')
      .then((res) => res.json())
      .then((data) => {
        if (data.voices && Array.isArray(data.voices)) {
          setVoices(data.voices);
        }
      })
      .catch((err) => console.warn('Could not load voice presets:', err));
  }, []);

  // Initialize streamer
  useEffect(() => {
    const streamer = new AudioStreamer();
    streamerRef.current = streamer;
    return () => {
      streamer.close();
    };
  }, []);

  // Toggle Mute
  const handleToggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    streamerRef.current?.setMute(nextMute);
    VerbalFeedbackEngine.setMuted(nextMute);
  };

  // Interrupt model speech immediately
  const handleInterrupt = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    streamerRef.current?.interrupt();
    wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    setStatus('interrupted');
    setTimeout(() => {
      setStatus('listening');
    }, 400);
  }, []);

  // Connect to Gemini Live Realtime WebSockets session
  const connectSession = async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');

      const streamer = streamerRef.current;
      if (!streamer) return;

      streamer.noiseGateThreshold = settings.noiseGateThreshold;
      const audioReady = await streamer.initAudio();
      if (!audioReady) {
        setErrorMessage('Failed to initialize browser Web Audio context.');
        setStatus('idle');
        return;
      }

      // Establish WebSocket connection
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live-voice`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected. Initializing Live Session...');
        setTelemetry((prev) => ({ ...prev, wsState: 'connected' }));

        const now = new Date();
        const clientHour = now.getHours();
        const clientTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const isCamActive = Boolean(cameraStream);
        const isScreenActive = Boolean(screenStream);

        // Send init message with voice preset, filler config and local time
        ws.send(
          JSON.stringify({
            type: 'init',
            voiceName: settingsRef.current.voiceName,
            fillerStyle: settingsRef.current.fillerStyle,
            customContext: settingsRef.current.customContext,
            clientHour,
            clientTime,
            hasScreen: isScreenActive,
            hasCamera: isCamActive,
          })
        );

        if (isScreenActive) {
          ws.send(JSON.stringify({ type: 'vision_source_changed', source: 'screen' }));
        } else if (isCamActive) {
          ws.send(JSON.stringify({ type: 'vision_source_changed', source: 'camera' }));
        }

        // Start ping intervals
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          }
        }, 2500);

        // Start session duration timer
        sessionStartTimeRef.current = Date.now();
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = setInterval(() => {
          if (sessionStartTimeRef.current) {
            const diff = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);
            setTelemetry((prev) => ({ ...prev, sessionDurationSec: diff }));
          }
        }, 1000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'session_ready') {
            console.log('Gemini Live session ready:', msg);
            setStatus('listening');

            // Add time-of-day welcoming message from the agent to conversation feed
            if (msg.greetingText) {
              setMessages((prev) => {
                if (prev.length === 0) {
                  return [
                    {
                      id: `agent-greeting-${Date.now()}`,
                      role: 'agent',
                      text: msg.greetingText,
                      tier: {
                        id: 'ultra_fast',
                        name: 'Ultra Fast',
                        badge: '⚡ Ultra Fast',
                        description: 'Time-of-day vocal greeting',
                        reason: `${msg.greeting || 'Time-aware greeting'} on voice session activation`,
                        thinkingBudget: 0,
                        color: 'emerald',
                      },
                      timestamp: Date.now(),
                    },
                  ];
                }
                return prev;
              });
            }

            // Start microphone streaming
            streamer.startMicrophone(
              (base64Chunk, rms) => {
                setMicVolumeLevel(rms);
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: 'audio_chunk',
                      audio: base64Chunk,
                    })
                  );
                  setTelemetry((prev) => ({
                    ...prev,
                    audioPacketsSent: prev.audioPacketsSent + 1,
                    micVolumeLevel: rms,
                  }));
                }
              },
              (isSpeaking) => {
                setIsUserSpeaking(isSpeaking);
              }
            );
          } else if (msg.type === 'audio') {
            // Model Audio Output Chunk (24kHz PCM)
            setStatus('speaking');
            streamer.playPcmChunk(msg.audio, 24000);
            setTelemetry((prev) => ({
              ...prev,
              audioPacketsReceived: prev.audioPacketsReceived + 1,
            }));
          } else if (msg.type === 'transcript') {
            const textChunk = msg.text || '';
            setCurrentPartialAgentText((prev) => prev + textChunk);

            const lower = textChunk.toLowerCase();
            const isFiller = FILLER_TRIGGERS.some((trigger) => lower.includes(trigger));
            if (isFiller) {
              setTelemetry((prev) => ({
                ...prev,
                fillersUsedCount: prev.fillersUsedCount + 1,
              }));
            }
          } else if (msg.type === 'search_triggered') {
            // Realtime search triggered on websocket
            setActiveResearch({
              isSearching: true,
              keywordsDetected: msg.keywords || [],
              sources: [],
            });
          } else if (msg.type === 'auto_tier_switched') {
            if (msg.tier) {
              setCurrentTier(msg.tier);
            }
          } else if (msg.type === 'turn_complete') {
            setCurrentPartialAgentText((currentText) => {
              if (currentText.trim()) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `agent-${Date.now()}`,
                    role: 'agent',
                    text: currentText.trim(),
                    tier: currentTier,
                    timestamp: Date.now(),
                  },
                ]);
              }
              return '';
            });
            setStatus('listening');
            setActiveResearch((prev) => ({ ...prev, isSearching: false }));
          } else if (msg.type === 'interrupted') {
            streamer.interrupt();
            setStatus('listening');
            setCurrentPartialAgentText('');
            setActiveResearch((prev) => ({ ...prev, isSearching: false }));
          } else if (msg.type === 'tool_call') {
            console.log('Received Live Tool Call from AI:', msg.name, msg.args);
            if (msg.name === 'toggle_vision') {
              const mode = msg.args?.mode?.toLowerCase();
              if (mode === 'screen') {
                requestScreenShare();
              } else if (mode === 'camera') {
                startCameraFeed();
              } else if (mode === 'back_camera' || mode === 'rear_camera') {
                startCameraFeed('environment');
              } else if (mode === 'front_camera' || mode === 'selfie_camera') {
                startCameraFeed('user');
              } else if (mode === 'flip_camera') {
                toggleFacingMode();
              } else if (mode === 'off') {
                stopCameraFeed();
                stopScreenShare();
              }
            } else if (msg.name === 'control_session') {
              const action = msg.args?.action?.toLowerCase();
              if (action === 'disconnect') {
                disconnectSession();
              } else if (action === 'mute') {
                setIsMuted(true);
                streamerRef.current?.setMute(true);
              } else if (action === 'unmute') {
                setIsMuted(false);
                streamerRef.current?.setMute(false);
              }
            }
          } else if (msg.type === 'task_started') {
            console.log('Parallel Background Task started:', msg.task);
            if (msg.task) {
              setActiveTasks((prev) => {
                const exists = prev.some((t) => t.id === msg.task.id);
                return exists ? prev.map((t) => (t.id === msg.task.id ? msg.task : t)) : [...prev, msg.task];
              });
              VerbalFeedbackEngine.playChime('task_started');
            }
          } else if (msg.type === 'task_progress') {
            setActiveTasks((prev) =>
              prev.map((t) =>
                t.id === msg.taskId
                  ? {
                      ...t,
                      progressMessage: msg.progressMessage || t.progressMessage,
                      progressPercent: msg.progressPercent ?? t.progressPercent,
                    }
                  : t
              )
            );
          } else if (msg.type === 'task_completed') {
            console.log('Parallel Background Task completed:', msg.task);
            setActiveTasks((prev) => prev.filter((t) => t.id !== msg.taskId));
            if (msg.task) {
              setCompletedTasks((prev) => [msg.task, ...prev.filter((t) => t.id !== msg.taskId)]);
              setTaskCompletedToast(msg.task);
              setTimeout(() => setTaskCompletedToast((curr) => (curr?.id === msg.task.id ? null : curr)), 4000);
            }
            if (msg.displayCard) {
              setActiveSkillCard(msg.displayCard);
            }
            VerbalFeedbackEngine.playChime('task_completed');
          } else if (msg.type === 'task_failed') {
            console.warn('Parallel Background Task failed:', msg.task || msg.error);
            setActiveTasks((prev) => prev.filter((t) => t.id !== msg.taskId));
            if (msg.task) {
              setCompletedTasks((prev) => [msg.task, ...prev.filter((t) => t.id !== msg.taskId)]);
            }
          } else if (msg.type === 'task_cancelled') {
            setActiveTasks((prev) => prev.filter((t) => t.id !== msg.taskId));
          } else if (msg.type === 'skill_executed') {
            console.log('Skill executed in live session:', msg.skillName, msg.result);
            if (msg.result?.displayCard) {
              setActiveSkillCard(msg.result.displayCard);
            }
            if (msg.skillName === 'manage_reminders') {
              fetchReminders();
            }
          } else if (msg.type === 'pong') {
            const rtt = Date.now() - msg.clientTimestamp;
            setTelemetry((prev) => ({ ...prev, roundTripLatencyMs: rtt }));
          } else if (msg.type === 'error') {
            console.error('Live session server error:', msg.message);
            setErrorMessage(msg.message);
            setStatus('error');
          }
        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        disconnectSession();
      };

      ws.onerror = (err) => {
        console.error('WebSocket connection error:', err);
        setErrorMessage('Could not establish real-time voice connection.');
        disconnectSession();
      };
    } catch (err: any) {
      console.error('Error connecting session:', err);
      setErrorMessage(err?.message || 'Failed to start voice agent.');
      disconnectSession();
    }
  };

  // Disconnect voice session
  const disconnectSession = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);

    if (streamerRef.current) {
      streamerRef.current.stopMicrophone();
      streamerRef.current.interrupt();
    }

    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }

    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    setStatus('idle');
    setIsUserSpeaking(false);
    setCurrentPartialAgentText('');
    setTelemetry((prev) => ({ ...prev, wsState: 'disconnected' }));
  }, [cameraStream, screenStream]);

  // Hands-Free Voice Controller & Wake-Word Listener
  useVoiceControls({
    onActivateSession: () => {
      if (status === 'idle') {
        connectSession();
      }
    },
    onDisconnectSession: () => {
      if (status !== 'idle') {
        disconnectSession();
      }
    },
    onToggleMute: (muted: boolean) => {
      setIsMuted(muted);
      streamerRef.current?.setMute(muted);
    },
    onInterrupt: handleInterrupt,
    onCameraOn: () => startCameraFeed(),
    onCameraOff: stopCameraFeed,
    onScreenOn: requestScreenShare,
    onScreenOff: stopScreenShare,
    onFlipCamera: toggleFacingMode,
    onSetCameraFacingMode: (mode) => startCameraFeed(mode),
    isEnabled: true,
    isSessionActive: status !== 'idle',
  });

  // Update Settings
  const handleUpdateSettings = (newSettings: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      if (streamerRef.current && updated.noiseGateThreshold !== undefined) {
        streamerRef.current.noiseGateThreshold = updated.noiseGateThreshold;
      }
      return updated;
    });
  };

  // Play Speech Audio via TTS
  const handlePlayTTS = async (text: string) => {
    if (!text || !streamerRef.current) return;
    try {
      setStatus('speaking');
      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceName: settings.voiceName,
        }),
      });
      const data = await res.json();
      if (data.audio && streamerRef.current) {
        await streamerRef.current.initAudio();
        streamerRef.current.playPcmChunk(data.audio, 24000);
      }
    } catch (err) {
      console.error('Error synthesizing speech:', err);
    } finally {
      setStatus(isConnected ? 'listening' : 'idle');
    }
  };

  // Handle Multi-Input Send (Prompt + Attachments: links, images, videos, files, folders)
  const handleMultiSend = async (text: string, attachments: InputAttachment[]) => {
    if (!text.trim() && attachments.length === 0) return;

    // --- /voice slash command: real-time conversation mode ---
    // /voice on|start|connect|live -> connect live session
    // /voice off|stop|disconnect|end -> disconnect
    // /voice <text> -> auto-connect if needed, then send <text> via Gemini Live realtime (audio duplex)
    // Bare /voice -> toggle connect
    const trimmed = text.trim();
    const lowerTrim = trimmed.toLowerCase();
    const isVoiceCmd = lowerTrim === '/voice' || lowerTrim.startsWith('/voice ') || lowerTrim.startsWith('/voice\t');
    if (isVoiceCmd) {
      const arg = trimmed.slice(6).trim(); // after "/voice"
      const argLower = arg.toLowerCase();

      // Control subcommands
      if (argLower === '' || argLower === 'on' || argLower === 'start' || argLower === 'connect' || argLower === 'live' || argLower === 'open') {
        if (isConnected) {
          setMessages((prev) => [...prev, { id: `sys-${Date.now()}`, role: 'agent', text: 'Voice is already live — speak naturally, I am listening in real-time.', timestamp: Date.now() } as any]);
          return;
        }
        setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', text: '/voice', timestamp: Date.now() } as any]);
        VerbalFeedbackEngine.playChime('task_started');
        await connectSession();
        return;
      }
      if (argLower === 'off' || argLower === 'stop' || argLower === 'disconnect' || argLower === 'end' || argLower === 'close' || argLower === 'quit' || argLower === 'exit') {
        if (!isConnected) {
          setMessages((prev) => [...prev, { id: `sys-${Date.now()}`, role: 'agent', text: 'Voice is already idle.', timestamp: Date.now() } as any]);
          return;
        }
        setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', text: '/voice off', timestamp: Date.now() } as any]);
        disconnectSession();
        setMessages((prev) => [...prev, { id: `sys-${Date.now()}`, role: 'agent', text: 'Voice session ended.', timestamp: Date.now() } as any]);
        return;
      }

      // /voice <text> — realtime conversation: auto-connect then send via Live
      const voiceText = arg;
      if (voiceText) {
        // Show user turn
        const userMsg: MessageExchange = { id: `user-${Date.now()}`, role: 'user', text: voiceText, timestamp: Date.now() };
        setMessages((prev) => [...prev, userMsg]);
        VerbalFeedbackEngine.playChime('task_started');

        // If not connected, connect first then send as realtime once ready
        if (!isConnected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          await connectSession();
          // Wait for session_ready (max 4s), then send
          const start = Date.now();
          while (Date.now() - start < 4000) {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && status !== 'idle' && status !== 'connecting') break;
            // also check wsRef directly — after connectSession, ws becomes OPEN quickly
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              // give server a moment to create liveSession
              await new Promise((r) => setTimeout(r, 400));
              break;
            }
            await new Promise((r) => setTimeout(r, 120));
          }
        }
        // Send via realtime Live if possible
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            setStatus('thinking');
            wsRef.current.send(JSON.stringify({ type: 'text_prompt', text: voiceText }));
            return;
          } catch (e) {
            console.warn('Live send failed for /voice, falling back to flash:', e);
          }
        }
        // Fallback to flash if live not available (should rarely happen)
        // fall through to normal flash path with voiceText
        text = voiceText;
        // attachments already empty for /voice text, continue to flash path below
      } else {
        return;
      }
    }

    // 1. Acoustic & UI Feedback Trigger
    VerbalFeedbackEngine.playChime('task_started');

    const searchRegex = /\b(search|searching|searched|research|researching|look up|lookup|find|latest|news|today|price|stock|weather|who is|what happened|facts|study|citations)\b/i;
    const hasSearchKeywords = searchRegex.test(text) || attachments.some((a) => a.type === 'link');

    if (hasSearchKeywords) {
      setActiveResearch({
        isSearching: true,
        keywordsDetected: ['auto-search'],
        sources: [],
      });
    }

    // Spawn and track concurrent background task in Parallel Task Manager
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newTask: BackgroundTask = {
      id: taskId,
      type: hasSearchKeywords
        ? 'research'
        : text.toLowerCase().includes('weather')
        ? 'weather'
        : text.toLowerCase().includes('news')
        ? 'news'
        : text.toLowerCase().includes('obsidian') || text.toLowerCase().includes('note')
        ? 'obsidian'
        : text.toLowerCase().includes('hermes')
        ? 'hermes'
        : text.toLowerCase().includes('reminder')
        ? 'productivity'
        : text.toLowerCase().includes('calc') || text.toLowerCase().includes('math')
        ? 'calculation'
        : 'data_fetch',
      title: text ? text.slice(0, 40) : `Attachment Analysis (${attachments.length} items)`,
      prompt: text,
      status: 'running',
      startTime: Date.now(),
      verbalAcknowledgment: text ? getContextualVerbalPhrase(text) : undefined,
      progressPercent: 35,
      progressMessage: 'Executing concurrently in background...',
    };

    setActiveTasks((prev) => [...prev, newTask]);

    // Add user turn to conversation feed
    const userMsg: MessageExchange = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: text || (attachments.length > 0 ? `Sent ${attachments.length} attachment(s)` : ''),
      attachments,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);

    // If connected to live duplex WebSocket and sending pure text, route via WebSocket
    if (isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN && attachments.length === 0) {
      try {
        setStatus('thinking');
        wsRef.current.send(
          JSON.stringify({
            type: 'text_prompt',
            text,
          })
        );
        return;
      } catch (wsErr) {
        console.warn('Failed to send text over live WebSocket, falling back to Flash endpoint:', wsErr);
      }
    }

    try {
      setStatus('thinking');

      // Call multimodal flash endpoint concurrently
      const response = await fetch('/api/chat/flash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          attachments,
          history: messages.slice(-6).map((m) => ({
            role: m.role,
            text: m.text,
          })),
          systemInstruction: settings.customContext,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const sources: GroundingSource[] = data.sources || [];
      const autoSearchTriggered = Boolean(data.autoSearchTriggered);

      if (data.autoTier) {
        setCurrentTier(data.autoTier);
      }

      // Update active research state
      setActiveResearch({
        isSearching: false,
        keywordsDetected: data.matchedKeywords || [],
        sources,
        lastSearchedAt: Date.now(),
      });

      // Complete background task and update Parallel Task Dock
      const durationMs = Date.now() - newTask.startTime;
      const completedTask: BackgroundTask = {
        ...newTask,
        status: 'completed',
        completedTime: Date.now(),
        durationMs,
        progressPercent: 100,
        progressMessage: 'Fetched successfully',
        result: data,
        sources,
      };

      setActiveTasks((prev) => prev.filter((t) => t.id !== taskId));
      setCompletedTasks((prev) => [completedTask, ...prev.filter((t) => t.id !== taskId)]);
      setTaskCompletedToast(completedTask);
      VerbalFeedbackEngine.playChime('task_completed');
      setTimeout(() => setTaskCompletedToast((curr) => (curr?.id === taskId ? null : curr)), 4000);

      // Add agent response to conversation feed
      if (data.text) {
        const agentMsg: MessageExchange = {
          id: `agent-${Date.now()}`,
          role: 'agent',
          text: data.text,
          sources,
          tier: data.autoTier || currentTier,
          isAutoResearched: autoSearchTriggered,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, agentMsg]);

        // Synthesize spoken audio answer
        setStatus('speaking');
        try {
          const ttsRes = await fetch('/api/chat/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: data.text,
              voiceName: settings.voiceName,
            }),
          });
          const ttsData = await ttsRes.json();
          if (ttsData.audio && streamerRef.current) {
            await streamerRef.current.initAudio();
            streamerRef.current.playPcmChunk(ttsData.audio, 24000);
          }
        } catch (ttsErr) {
          console.warn('TTS fallback error:', ttsErr);
        }
      }

      setStatus(isConnected ? 'listening' : 'idle');
    } catch (err: any) {
      console.error('Error processing multi-input query:', err);
      let formattedError = err?.message || 'Failed to process prompt.';
      if (typeof formattedError === 'string' && formattedError.includes('{"error"')) {
        try {
          const jsonStart = formattedError.indexOf('{');
          const parsed = JSON.parse(formattedError.slice(jsonStart));
          formattedError = parsed?.error?.message || parsed?.message || formattedError;
        } catch (e) {
          // Keep as is
        }
      }

      // Mark task as failed
      setActiveTasks((prev) => prev.filter((t) => t.id !== taskId));
      const failedTask: BackgroundTask = {
        ...newTask,
        status: 'failed',
        completedTime: Date.now(),
        durationMs: Date.now() - newTask.startTime,
        error: formattedError,
        progressMessage: `Failed: ${formattedError}`,
      };
      setCompletedTasks((prev) => [failedTask, ...prev]);

      setErrorMessage(formattedError);
      setStatus(isConnected ? 'listening' : 'idle');
      setActiveResearch((prev) => ({ ...prev, isSearching: false }));
    }
  };

  const isConnected = status !== 'idle' && status !== 'error';

  return (
    <div className="min-h-screen friday-radial-bg text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30 selection:text-cyan-200 p-4 sm:p-6 select-none">
      {/* Top Header */}
      <header
        id="app-header"
        className="w-full max-w-2xl mx-auto flex items-center justify-between py-2"
      >
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-extrabold font-mono tracking-[0.25em] friday-title-gradient uppercase">
            FRIDAY
          </h1>
          <span
            className={`w-2 h-2 rounded-full shadow-lg ${
              isConnected ? 'bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'bg-slate-600'
            }`}
          />
          {/* Hermes Gateway live status pill */}
          <button
            id="hermes-gateway-status"
            onClick={fetchHermesHealth}
            title="Hermes gateway status — click to refresh"
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-colors ${
              hermesConn === 'live'
                ? 'bg-violet-500/15 border-violet-400/50 text-violet-300 shadow-[0_0_10px_rgba(167,139,250,0.35)]'
                : hermesConn === 'cli'
                ? 'bg-slate-700/40 border-slate-500/50 text-slate-300'
                : hermesConn === 'offline'
                ? 'bg-rose-500/15 border-rose-400/50 text-rose-300'
                : 'bg-slate-800/40 border-slate-600/50 text-slate-400'
            }`}
          >
            <Bot className="w-3 h-3" />
            <span>
              {hermesConn === 'live' && 'HERMES LIVE'}
              {hermesConn === 'cli' && 'HERMES CLI'}
              {hermesConn === 'offline' && 'HERMES OFFLINE'}
              {hermesConn === 'checking' && 'HERMES…'}
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                hermesConn === 'live'
                  ? 'bg-violet-400 animate-pulse'
                  : hermesConn === 'cli'
                  ? 'bg-slate-300'
                  : hermesConn === 'offline'
                  ? 'bg-rose-400'
                  : 'bg-slate-500 animate-pulse'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Parallel Tasks HUD Status Indicator */}
          {activeTasks.length > 0 && (
            <div className="px-2.5 py-1 rounded-full bg-cyan-950/90 border border-cyan-500/60 text-cyan-300 text-xs font-mono font-bold flex items-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.4)] animate-pulse">
              <Zap className="w-3 h-3 text-cyan-400 animate-spin" />
              <span>{activeTasks.length} Parallel Task{activeTasks.length > 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Modular Skills Hub Button */}
          <button
            id="open-skills-hub-btn"
            onClick={() => setIsSkillsModalOpen(true)}
            className="p-2 text-slate-400 hover:text-cyan-300 rounded-full hover:bg-slate-800/60 transition-colors"
            title="Modular Skills Hub"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </button>

          {/* Smart Reminders Drawer Button with Count Badge */}
          <button
            id="open-reminders-drawer-btn"
            onClick={() => setIsRemindersOpen(true)}
            className="p-2 text-slate-400 hover:text-amber-300 rounded-full hover:bg-slate-800/60 transition-colors relative"
            title="Smart Reminders & Alarms"
          >
            <Bell className="w-4 h-4 text-amber-400" />
            {reminders.filter((r) => !r.completed).length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-amber-500 text-[9px] font-mono font-bold text-slate-950 flex items-center justify-center">
                {reminders.filter((r) => !r.completed).length}
              </span>
            )}
          </button>

          {/* Settings Button */}
          <button
            id="open-audio-settings-btn"
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-slate-400 hover:text-cyan-300 rounded-full hover:bg-slate-800/60 transition-colors"
            title="Settings"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Center Main Stage */}
      <main className="w-full max-w-2xl mx-auto flex-1 flex flex-col items-center justify-center my-auto">
        {/* Parallel Execution Background Tasks Dock */}
        <ParallelTaskDock
          activeTasks={activeTasks}
          completedTasks={completedTasks}
          onCancelTask={handleCancelTask}
          onSelectDisplayCard={(card) => setActiveSkillCard(card)}
        />

        {/* Parallel Task Completed Dynamic Notification Toast */}
        {taskCompletedToast && (
          <div
            id="task-completed-toast"
            className="w-full mb-3 p-3 rounded-2xl bg-gradient-to-r from-slate-950/95 via-cyan-950/90 to-slate-950/95 border border-cyan-400/60 text-slate-100 text-xs shadow-2xl flex items-center justify-between gap-3 animate-fadeIn"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg bg-cyan-500 text-slate-950 shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="truncate">
                <span className="font-mono uppercase font-bold text-cyan-300 mr-2 text-[10px]">
                  Background Task Ready:
                </span>
                <span className="font-semibold text-white truncate">{taskCompletedToast.title}</span>
                {taskCompletedToast.durationMs && (
                  <span className="text-[10px] text-slate-400 font-mono ml-2">
                    ({(taskCompletedToast.durationMs / 1000).toFixed(1)}s)
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {taskCompletedToast.displayCard && (
                <button
                  onClick={() => {
                    setActiveSkillCard(taskCompletedToast.displayCard!);
                    setTaskCompletedToast(null);
                  }}
                  className="px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[11px] font-mono transition-colors"
                >
                  View Result
                </button>
              )}
              <button
                onClick={() => setTaskCompletedToast(null)}
                className="p-1 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Active Due Reminder Alert Toast Banner */}
        {dueReminderAlert && (
          <div className="w-full mb-3 p-3 rounded-2xl bg-amber-950/90 border border-amber-500/60 text-amber-100 text-xs shadow-2xl flex items-center justify-between gap-3 animate-bounce">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg bg-amber-500 text-slate-950 shrink-0">
                <Bell className="w-4 h-4 animate-spin" />
              </div>
              <div className="truncate">
                <span className="font-mono uppercase font-bold text-amber-300 mr-2 text-[10px]">
                  Reminder Due:
                </span>
                <span className="font-semibold text-white">{dueReminderAlert.text}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => handleCompleteReminder(dueReminderAlert.id)}
                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] transition-colors"
              >
                Mark Done
              </button>
              <button
                onClick={() => setDueReminderAlert(null)}
                className="p-1 text-amber-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {(errorMessage || visionError) && (
          <div className="w-full mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800/50 text-rose-200 text-xs flex items-center justify-between gap-3 animate-fadeIn flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="font-mono">{errorMessage || visionError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <button
                onClick={() => {
                  setErrorMessage(null);
                  setVisionError(null);
                }}
                className="text-rose-400 hover:text-rose-100 text-xs font-mono px-2 py-0.5"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Active Modular Skill Live Display Card (Weather, News, Reminders, Math) */}
        {activeSkillCard && (
          <SkillDisplayCard
            card={activeSkillCard}
            onDismiss={() => setActiveSkillCard(null)}
            onAction={(action, payload) => {
              if (action === 'complete_reminder' && payload) {
                handleCompleteReminder(payload);
              }
            }}
          />
        )}

        {/* Center Stage: Title + Luminous Holographic Cyber Orb from Splash Design */}
        <div className="w-full flex flex-col items-center justify-center">
          <div className="text-center mb-1 animate-fadeIn">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-[0.25em] friday-title-gradient uppercase">
              FRIDAY
            </h2>
          </div>

          <VoiceVisualizer
            status={status}
            streamer={streamerRef.current}
            isUserSpeaking={isUserSpeaking}
            isMuted={isMuted}
          />

          {/* Cyber Status & Activity Indicator */}
          <div className="text-center mt-2 mb-6 animate-fadeIn">
            <p className="text-xs font-mono tracking-[0.2em] font-semibold uppercase">
              {status === 'speaking' && <span className="text-cyan-400">Transmitting Speech...</span>}
              {status === 'listening' && <span className="text-emerald-400">Listening to Voice...</span>}
              {status === 'thinking' && <span className="text-amber-400">Processing Neural Reasoning...</span>}
              {status === 'connecting' && <span className="text-sky-400">Connecting Neural Voice Interface...</span>}
              {status === 'interrupted' && <span className="text-rose-400">Speech Interrupted</span>}
              {status === 'idle' && <span className="text-slate-400">Ready • Plain Voice Interface</span>}
            </p>
            <div className="w-44 h-0.5 bg-white/10 rounded-full overflow-hidden mx-auto mt-2.5 relative">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isConnected
                    ? 'w-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 shadow-[0_0_8px_rgba(56,189,248,0.9)]'
                    : 'w-1/4 bg-slate-600/50'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Plain Floating Controls */}
        <div className="flex items-center justify-center gap-2.5 sm:gap-3 mb-6 flex-wrap">
          {/* Mic Mute Toggle */}
          <button
            id="toggle-mic-mute-btn"
            onClick={handleToggleMute}
            disabled={!isConnected}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              isMuted
                ? 'bg-rose-500 text-white'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white'
            } disabled:opacity-30 disabled:pointer-events-none`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Camera Feed Toggle */}
          <button
            id="toggle-camera-feed-btn"
            onClick={cameraStream ? stopCameraFeed : () => startCameraFeed()}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              cameraStream
                ? 'bg-cyan-500 text-white ring-2 ring-cyan-400/50'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white'
            }`}
            title={cameraStream ? 'Stop Camera Feed ("camera off")' : 'Start Camera Feed ("camera on")'}
          >
            {cameraStream ? <Camera className="w-4 h-4 text-white" /> : <CameraOff className="w-4 h-4" />}
          </button>

          {/* Quick Flip Camera (Front/Rear) Button when Camera Active */}
          {cameraStream && (
            <button
              id="flip-camera-toolbar-btn"
              onClick={toggleFacingMode}
              className="w-11 h-11 rounded-full flex items-center justify-center bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 hover:text-white border border-cyan-500/40 transition-all animate-fadeIn"
              title={`Flip to ${facingMode === 'user' ? 'Rear / Back' : 'Front / Selfie'} Camera ("flip camera")`}
            >
              <RefreshCw className="w-4 h-4 text-cyan-400" />
            </button>
          )}

          {/* Screen Share Toggle */}
          <button
            id="toggle-screen-share-btn"
            onClick={screenStream ? stopScreenShare : requestScreenShare}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              screenStream
                ? 'bg-cyan-500 text-white ring-2 ring-cyan-400/50'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white'
            }`}
            title={screenStream ? 'Stop Screen Share ("stop screen")' : 'Start Screen Share ("share screen")'}
          >
            {screenStream ? <Monitor className="w-4 h-4 text-white" /> : <MonitorOff className="w-4 h-4" />}
          </button>

          {/* Primary Connect / Engage Button */}
          <button
            id="primary-connect-disconnect-btn"
            onClick={isConnected ? disconnectSession : connectSession}
            className={`px-6 py-3 rounded-full font-mono text-xs font-semibold tracking-wider flex items-center gap-2.5 transition-all shadow-md ${
              isConnected
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-cyan-500 hover:bg-cyan-400 text-white'
            }`}
          >
            <Power className="w-4 h-4" />
            <span>{isConnected ? 'End Session' : 'Engage F.R.I.D.A.Y.'}</span>
          </button>

          {/* Interrupt Button */}
          <button
            id="interrupt-speech-btn"
            onClick={handleInterrupt}
            disabled={!isConnected || status !== 'speaking'}
            className="w-11 h-11 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none"
            title="Interrupt"
          >
            <StopCircle className="w-4 h-4 text-amber-400" />
          </button>
        </div>

        {/* Live Grounding Sources Indicator */}
        <AutoResearchCard
          isSearching={activeResearch.isSearching}
          matchedKeywords={activeResearch.keywordsDetected}
          sources={activeResearch.sources}
        />
      </main>

      {/* Live Vision Picture-in-Picture Preview Window */}
      <LiveVisionPreview
        cameraStream={cameraStream}
        screenStream={screenStream}
        facingMode={facingMode}
        onCloseCamera={stopCameraFeed}
        onCloseScreen={stopScreenShare}
        onSwitchToCamera={() => startCameraFeed()}
        onSwitchToScreen={requestScreenShare}
        onFlipCamera={toggleFacingMode}
      />

      {/* Bottom Floating Plain Input Bar */}
      <footer className="w-full max-w-2xl mx-auto pt-2">
        <MultiInputBar
          onSend={handleMultiSend}
          disabled={status === 'connecting'}
          isConnected={isConnected}
          onPreviewAttachment={(att) => setPreviewAttachment(att)}
        />
      </footer>

      {/* Attachment Preview Modal */}
      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />

      {/* Audio Settings Modal */}
      <AudioSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        voices={voices}
        micVolume={micVolumeLevel}
      />

      {/* Smart Reminders Drawer Modal */}
      <RemindersDrawer
        isOpen={isRemindersOpen}
        onClose={() => setIsRemindersOpen(false)}
        reminders={reminders}
        onCreateReminder={handleCreateReminder}
        onCompleteReminder={handleCompleteReminder}
        onDeleteReminder={handleDeleteReminder}
      />

      {/* Modular Skills Hub Modal */}
      <SkillsHubModal
        isOpen={isSkillsModalOpen}
        onClose={() => setIsSkillsModalOpen(false)}
        onRunPrompt={(prompt) => {
          handleMultiSend(prompt, []);
        }}
      />
    </div>
  );
}

