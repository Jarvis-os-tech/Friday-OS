import React, { useEffect, useRef, useState } from 'react';
import { Camera, Monitor, X, Eye, RefreshCw, Maximize2, Minimize2, Sparkles } from 'lucide-react';

interface LiveVisionPreviewProps {
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  facingMode?: 'user' | 'environment';
  onCloseCamera: () => void;
  onCloseScreen: () => void;
  onSwitchToCamera: () => void;
  onSwitchToScreen: () => void;
  onFlipCamera?: () => void;
}

export function LiveVisionPreview({
  cameraStream,
  screenStream,
  facingMode = 'user',
  onCloseCamera,
  onCloseScreen,
  onSwitchToCamera,
  onSwitchToScreen,
  onFlipCamera,
}: LiveVisionPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStream = cameraStream || screenStream;
  const isCamera = Boolean(cameraStream);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  useEffect(() => {
    if (videoRef.current && activeStream) {
      videoRef.current.srcObject = activeStream;
      videoRef.current.play().catch((err) => {
        console.warn('Live preview autoplay note:', err);
      });
    }
  }, [activeStream]);

  if (!activeStream) return null;

  return (
    <div
      id="live-vision-pip"
      className={`fixed z-40 bg-slate-950/95 backdrop-blur-2xl border border-cyan-500/40 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 ${
        isExpanded
          ? 'bottom-20 right-3 left-3 sm:left-auto sm:right-6 sm:w-96 md:w-[480px] max-w-[calc(100vw-24px)]'
          : 'bottom-20 right-3 sm:bottom-24 sm:right-6 w-48 sm:w-56 md:w-64'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 sm:px-3 py-1.5 bg-slate-900/90 border-b border-slate-800/80 text-[10px] font-mono select-none">
        <div className="flex items-center gap-1.5 text-cyan-400 font-semibold truncate">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
          <span className="truncate">
            {isCamera
              ? facingMode === 'environment'
                ? 'REAR CAMERA'
                : 'FRONT CAMERA'
              : 'SCREEN STREAM'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Flip Front/Back Camera (on mobile/tablet or webcams) */}
          {isCamera && onFlipCamera && (
            <button
              type="button"
              id="flip-camera-pip-btn"
              onClick={onFlipCamera}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 flex items-center gap-1 text-[9px] transition-colors"
              title="Flip Front/Rear Camera ('flip camera')"
            >
              <RefreshCw className="w-2.5 h-2.5 text-cyan-400" />
              <span className="hidden sm:inline">Flip</span>
            </button>
          )}

          {/* Switch Source */}
          {isCamera ? (
            <button
              type="button"
              id="switch-to-screen-pip-btn"
              onClick={onSwitchToScreen}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 flex items-center gap-1 text-[9px] transition-colors"
              title="Switch to Screen Sharing ('switch to screen')"
            >
              <Monitor className="w-2.5 h-2.5" />
              <span className="hidden xs:inline">Screen</span>
            </button>
          ) : (
            <button
              type="button"
              id="switch-to-camera-pip-btn"
              onClick={onSwitchToCamera}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 flex items-center gap-1 text-[9px] transition-colors"
              title="Switch to Camera ('switch to camera')"
            >
              <Camera className="w-2.5 h-2.5" />
              <span className="hidden xs:inline">Camera</span>
            </button>
          )}

          {/* Expand/Collapse */}
          <button
            type="button"
            id="toggle-expand-pip-btn"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-cyan-300 p-1 rounded transition-colors"
            title={isExpanded ? 'Minimize preview' : 'Expand preview'}
          >
            {isExpanded ? (
              <Minimize2 className="w-3 h-3" />
            ) : (
              <Maximize2 className="w-3 h-3" />
            )}
          </button>

          {/* Close */}
          <button
            type="button"
            id="close-vision-pip-btn"
            onClick={isCamera ? onCloseCamera : onCloseScreen}
            className="text-slate-400 hover:text-rose-400 p-1 rounded transition-colors"
            title="Stop Vision Feed ('stop vision')"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Video Viewport */}
      <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-transform ${
            isCamera && facingMode === 'user' ? 'scale-x-[-1]' : ''
          }`}
        />
        <div className="absolute bottom-1.5 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/70 text-[9px] font-mono text-slate-200 backdrop-blur-md border border-white/10">
          <Eye className="w-2.5 h-2.5 text-cyan-400 animate-pulse" />
          <span className="tracking-wide">AI REAL-TIME VISION</span>
        </div>
      </div>
    </div>
  );
}
