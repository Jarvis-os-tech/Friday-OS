import React, { useEffect, useRef, useState } from 'react';
import { AgentStatus } from '../types';
import { AudioStreamer } from '../utils/audioStreamer';

interface VoiceVisualizerProps {
  status: AgentStatus;
  streamer: AudioStreamer | null;
  isUserSpeaking: boolean;
  isMuted: boolean;
}

export const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({
  status,
  streamer,
  isUserSpeaking,
  isMuted,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const phaseRef = useRef<number>(0);

  // Live audio bar heights for central equalizer
  const [waveHeights, setWaveHeights] = useState<number[]>([16, 26, 38, 24, 14]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = container.clientWidth * window.devicePixelRatio);
    let height = (canvas.height = container.clientHeight * window.devicePixelRatio);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        width = canvas.width = Math.max(10, w * window.devicePixelRatio);
        height = canvas.height = Math.max(10, h * window.devicePixelRatio);
      }
    });

    resizeObserver.observe(container);

    // Orbital particles
    const particles: Array<{
      radius: number;
      angle: number;
      speed: number;
      distance: number;
      alpha: number;
    }> = [];

    const numParticles = 28;
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        radius: 1.2 + Math.random() * 2.2,
        angle: (i / numParticles) * Math.PI * 2,
        speed: 0.008 + Math.random() * 0.012,
        distance: 85 + Math.random() * 70,
        alpha: 0.2 + Math.random() * 0.5,
      });
    }

    let frameCount = 0;

    const render = () => {
      frameCount++;
      phaseRef.current += 0.035;
      const phase = phaseRef.current;

      const dpr = window.devicePixelRatio || 1;
      const displayW = width / dpr;
      const displayH = height / dpr;
      const centerX = displayW / 2;
      const centerY = displayH / 2;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, displayW, displayH);

      // Extract real audio levels
      let micEnergy = 0;
      let agentEnergy = 0;

      if (streamer) {
        streamer.updateFrequencyData();
        if (isUserSpeaking && !isMuted) {
          let sum = 0;
          for (let i = 0; i < 32; i++) {
            sum += streamer.micDataArray[i];
          }
          micEnergy = Math.min(1.8, (sum / 32 / 255) * 2.4);
        }

        if (status === 'speaking' || streamer.isAgentSpeaking()) {
          let sum = 0;
          for (let i = 0; i < 32; i++) {
            sum += streamer.agentDataArray[i];
          }
          agentEnergy = Math.min(1.8, (sum / 32 / 255) * 2.6);
        }
      }

      const activeEnergy = Math.max(micEnergy, agentEnergy);

      // Update live wave heights every 3 frames for reactive equalizer
      if (frameCount % 3 === 0) {
        if (activeEnergy > 0.08) {
          setWaveHeights([
            14 + activeEnergy * 18 * (0.8 + Math.sin(phase * 4) * 0.2),
            22 + activeEnergy * 28 * (0.8 + Math.cos(phase * 3) * 0.2),
            32 + activeEnergy * 36 * (0.8 + Math.sin(phase * 5) * 0.2),
            20 + activeEnergy * 26 * (0.8 + Math.cos(phase * 4) * 0.2),
            12 + activeEnergy * 16 * (0.8 + Math.sin(phase * 3) * 0.2),
          ]);
        } else {
          setWaveHeights([
            14 + Math.sin(phase * 2) * 4,
            22 + Math.sin(phase * 2.5 + 0.5) * 6,
            32 + Math.sin(phase * 3 + 1) * 8,
            20 + Math.sin(phase * 2.5 + 1.5) * 6,
            12 + Math.sin(phase * 2 + 2) * 4,
          ]);
        }
      }

      // Base radius of outer aura
      const baseRadius = 65 + activeEnergy * 24;

      // Draw subtle orbital particles
      particles.forEach((p) => {
        p.angle += p.speed * (1 + activeEnergy * 1.5);
        const dist = p.distance + Math.sin(phase + p.angle) * 8 + activeEnergy * 20;
        const px = centerX + Math.cos(p.angle) * dist;
        const py = centerY + Math.sin(p.angle) * dist;

        ctx.beginPath();
        ctx.arc(px, py, p.radius * (1 + activeEnergy * 0.5), 0, Math.PI * 2);
        if (status === 'speaking') {
          ctx.fillStyle = `rgba(56, 189, 248, ${p.alpha * 0.75})`;
        } else if (isUserSpeaking || status === 'listening') {
          ctx.fillStyle = `rgba(74, 222, 128, ${p.alpha * 0.75})`;
        } else if (status === 'thinking') {
          ctx.fillStyle = `rgba(250, 204, 21, ${p.alpha * 0.75})`;
        } else {
          ctx.fillStyle = `rgba(148, 163, 184, ${p.alpha * 0.4})`;
        }
        ctx.fill();
      });

      // Harmonic resonance wave rings
      const rings = 2;
      for (let r = 1; r <= rings; r++) {
        const ringRad = baseRadius + r * 28 + activeEnergy * 16 * r;
        ctx.beginPath();
        const segments = 48;
        for (let i = 0; i <= segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          const harmonic = Math.sin(theta * 4 + phase * (r % 2 === 0 ? 1.5 : -1.5)) * (3 + activeEnergy * 8);
          const rad = ringRad + harmonic;
          const px = centerX + Math.cos(theta) * rad;
          const py = centerY + Math.sin(theta) * rad;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();

        if (status === 'speaking') {
          ctx.strokeStyle = `rgba(56, 189, 248, ${(0.3 / r) * (1 + activeEnergy)})`;
        } else if (isUserSpeaking || status === 'listening') {
          ctx.strokeStyle = `rgba(74, 222, 128, ${(0.3 / r) * (1 + activeEnergy)})`;
        } else if (status === 'thinking') {
          ctx.strokeStyle = `rgba(234, 179, 8, ${(0.3 / r) * (1 + activeEnergy)})`;
        } else {
          ctx.strokeStyle = `rgba(56, 189, 248, ${0.12 / r})`;
        }
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.restore();

      animationFrameId.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      resizeObserver.disconnect();
    };
  }, [status, streamer, isUserSpeaking, isMuted]);

  // Determine state-based classes
  const getOrbClass = () => {
    if (status === 'speaking') return 'friday-orb-speaking';
    if (status === 'listening' || isUserSpeaking) return 'friday-orb-listening';
    if (status === 'thinking') return 'friday-orb-thinking';
    return 'friday-orb-base';
  };

  const getPulseClass1 = () => {
    if (status === 'speaking') return 'pulse-ring-cyan';
    if (status === 'listening' || isUserSpeaking) return 'pulse-ring-emerald';
    if (status === 'thinking') return 'pulse-ring-amber';
    return 'pulse-ring-cyan';
  };

  const getPulseClass2 = () => {
    if (status === 'speaking') return 'pulse-ring-purple';
    if (status === 'listening' || isUserSpeaking) return 'pulse-ring-cyan';
    if (status === 'thinking') return 'pulse-ring-purple';
    return 'pulse-ring-purple';
  };

  return (
    <div
      id="voice-visualizer-container"
      ref={containerRef}
      className="relative w-full h-72 sm:h-80 flex items-center justify-center select-none overflow-hidden"
    >
      {/* Background Ambient Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Central Holographic Cyber-Orb from Splash Design */}
      <div className="relative z-10 w-44 h-44 sm:w-48 sm:h-48 flex items-center justify-center">
        {/* Pulsating Concentric Glow Rings */}
        <div className={`absolute inset-0 rounded-full ${getPulseClass1()}`} />
        <div className={`absolute inset-0 rounded-full ${getPulseClass2()}`} />

        {/* 3D Glowing Core Sphere */}
        <div
          className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl ${getOrbClass()}`}
        >
          {/* Specular Highlight */}
          <div className="absolute top-2 left-3 w-10 h-5 rounded-full bg-white/30 blur-[2px] transform -rotate-45 pointer-events-none" />

          {/* Central Live Equalizer Waves */}
          <div className="flex items-center gap-1 sm:gap-1.5 z-20">
            {waveHeights.map((h, i) => (
              <div
                key={i}
                style={{ height: `${h}px` }}
                className="w-1 sm:w-1.5 bg-white rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(255,255,255,0.9)]"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
