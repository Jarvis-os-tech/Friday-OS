import { useEffect, useRef } from "react";

interface VoiceControlOptions {
  onActivateSession?: () => void;
  onDisconnectSession?: () => void;
  onToggleMute?: (muted: boolean) => void;
  onInterrupt?: () => void;
  onCameraOn: () => void;
  onCameraOff: () => void;
  onScreenOn: () => void;
  onScreenOff: () => void;
  onFlipCamera?: () => void;
  onSetCameraFacingMode?: (mode: 'user' | 'environment') => void;
  onCommandDetected?: (command: string) => void;
  isEnabled: boolean;
  isSessionActive: boolean;
}

export function useVoiceControls({
  onActivateSession,
  onDisconnectSession,
  onToggleMute,
  onInterrupt,
  onCameraOn,
  onCameraOff,
  onScreenOn,
  onScreenOff,
  onFlipCamera,
  onSetCameraFacingMode,
  onCommandDetected,
  isEnabled,
  isSessionActive,
}: VoiceControlOptions) {
  const recognitionRef = useRef<any>(null);
  const hasErrorRef = useRef<boolean>(false);
  const isSessionActiveRef = useRef(isSessionActive);
  isSessionActiveRef.current = isSessionActive;
  const restartTimeoutRef = useRef<any>(null);
  const lastTriggerTimeRef = useRef<number>(0);
  const lastTriggerPhraseRef = useRef<string>("");

  // Store latest callbacks in refs to avoid recreating the listener needlessly
  const onActivateSessionRef = useRef(onActivateSession);
  const onDisconnectSessionRef = useRef(onDisconnectSession);
  const onToggleMuteRef = useRef(onToggleMute);
  const onInterruptRef = useRef(onInterrupt);
  const onCameraOnRef = useRef(onCameraOn);
  const onCameraOffRef = useRef(onCameraOff);
  const onScreenOnRef = useRef(onScreenOn);
  const onScreenOffRef = useRef(onScreenOff);
  const onFlipCameraRef = useRef(onFlipCamera);
  const onSetCameraFacingModeRef = useRef(onSetCameraFacingMode);
  const onCommandDetectedRef = useRef(onCommandDetected);

  useEffect(() => {
    onActivateSessionRef.current = onActivateSession;
    onDisconnectSessionRef.current = onDisconnectSession;
    onToggleMuteRef.current = onToggleMute;
    onInterruptRef.current = onInterrupt;
    onCameraOnRef.current = onCameraOn;
    onCameraOffRef.current = onCameraOff;
    onScreenOnRef.current = onScreenOn;
    onScreenOffRef.current = onScreenOff;
    onFlipCameraRef.current = onFlipCamera;
    onSetCameraFacingModeRef.current = onSetCameraFacingMode;
    onCommandDetectedRef.current = onCommandDetected;
  });

  useEffect(() => {
    if (!isEnabled || hasErrorRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("Web SpeechRecognition API not supported in this browser.");
      return;
    }

    let isStoppedExplicitly = false;

    const shouldDebounce = (cmdKey: string) => {
      const now = Date.now();
      if (
        lastTriggerPhraseRef.current === cmdKey &&
        now - lastTriggerTimeRef.current < 2500
      ) {
        return true;
      }
      lastTriggerTimeRef.current = now;
      lastTriggerPhraseRef.current = cmdKey;
      return false;
    };

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript.toLowerCase().trim();
          if (!transcript) continue;

          console.log("Voice listener detected speech:", transcript);

          // 1. Session Wake / Activation commands
          if (
            transcript.includes("hey friday") ||
            transcript.includes("hey jarvis") ||
            transcript.includes("hello friday") ||
            transcript.includes("hello jarvis") ||
            transcript.includes("hi friday") ||
            transcript.includes("wake up") ||
            transcript.includes("start assistant") ||
            transcript.includes("start listening") ||
            transcript.includes("connect assistant") ||
            transcript.includes("connect voice") ||
            transcript.includes("activate assistant") ||
            transcript.includes("listen to me") ||
            (transcript === "friday" || transcript === "jarvis" || transcript === "connect")
          ) {
            if (!shouldDebounce("wake_session")) {
              onCommandDetectedRef.current?.(`Wake Word: "${transcript}"`);
              if (!isSessionActiveRef.current) {
                onActivateSessionRef.current?.();
              }
            }
            return;
          }

          // 2. Camera Flip / Rear / Front specific commands
          if (
            transcript.includes("flip camera") ||
            transcript.includes("switch camera") ||
            transcript.includes("change camera") ||
            transcript.includes("turn camera around") ||
            transcript.includes("reverse camera")
          ) {
            if (!shouldDebounce("flip_camera")) {
              onCommandDetectedRef.current?.(`Flip Camera: "${transcript}"`);
              onFlipCameraRef.current?.();
            }
            return;
          }

          if (
            transcript.includes("back camera") ||
            transcript.includes("rear camera") ||
            transcript.includes("environment camera") ||
            transcript.includes("switch to back camera") ||
            transcript.includes("switch to rear camera") ||
            transcript.includes("use back camera") ||
            transcript.includes("use rear camera") ||
            transcript.includes("show what is in front") ||
            transcript.includes("look in front")
          ) {
            if (!shouldDebounce("rear_camera")) {
              onCommandDetectedRef.current?.(`Rear Camera: "${transcript}"`);
              onSetCameraFacingModeRef.current?.('environment');
            }
            return;
          }

          if (
            transcript.includes("front camera") ||
            transcript.includes("selfie camera") ||
            transcript.includes("user camera") ||
            transcript.includes("switch to front camera") ||
            transcript.includes("switch to selfie camera") ||
            transcript.includes("use front camera") ||
            transcript.includes("use selfie camera")
          ) {
            if (!shouldDebounce("front_camera")) {
              onCommandDetectedRef.current?.(`Front Camera: "${transcript}"`);
              onSetCameraFacingModeRef.current?.('user');
            }
            return;
          }

          // 3. Screen Share Activation & Switching triggers
          if (
            transcript.includes("share screen") ||
            transcript.includes("screenshare") ||
            transcript.includes("screen share") ||
            transcript.includes("screen sharing") ||
            transcript.includes("start screen") ||
            transcript.includes("screen on") ||
            transcript.includes("share my screen") ||
            transcript.includes("open screen") ||
            transcript.includes("switch to screen") ||
            transcript.includes("switch to screen share") ||
            transcript.includes("switch to screenshare") ||
            transcript.includes("change to screen") ||
            transcript.includes("change to screen share") ||
            transcript.includes("show screen") ||
            transcript.includes("show my screen") ||
            transcript.includes("look at screen") ||
            transcript.includes("look at my screen") ||
            transcript.includes("look at the screen") ||
            transcript.includes("look at this code") ||
            transcript.includes("look at my code") ||
            transcript.includes("see my screen") ||
            transcript.includes("screen mode") ||
            transcript.includes("display share") ||
            transcript.includes("share display") ||
            transcript.includes("stream screen")
          ) {
            if (!shouldDebounce("screen_on")) {
              onCommandDetectedRef.current?.(`Screen Share: "${transcript}"`);
              onScreenOnRef.current?.();
            }
            return;
          }

          // 4. Camera Activation & Switching triggers
          if (
            transcript.includes("camera on") ||
            transcript.includes("activate camera") ||
            transcript.includes("start camera") ||
            transcript.includes("open camera") ||
            transcript.includes("turn on camera") ||
            transcript.includes("enable camera") ||
            transcript.includes("switch to camera") ||
            transcript.includes("switch to webcam") ||
            transcript.includes("change to camera") ||
            transcript.includes("show camera") ||
            transcript.includes("show my camera") ||
            transcript.includes("look at camera") ||
            transcript.includes("look at my camera") ||
            transcript.includes("look at me") ||
            transcript.includes("webcam on") ||
            transcript.includes("turn on webcam") ||
            transcript.includes("activate webcam") ||
            transcript.includes("camera mode") ||
            transcript.includes("video on") ||
            transcript.includes("start video") ||
            transcript.includes("open webcam")
          ) {
            if (!shouldDebounce("camera_on")) {
              onCommandDetectedRef.current?.(`Camera Command: "${transcript}"`);
              onCameraOnRef.current?.();
            }
            return;
          }

          // 5. Screen Share Deactivation triggers
          if (
            transcript.includes("stop screen") ||
            transcript.includes("close screen") ||
            transcript.includes("screen off") ||
            transcript.includes("stop sharing") ||
            transcript.includes("stop screenshare") ||
            transcript.includes("stop screen sharing") ||
            transcript.includes("turn off screen") ||
            transcript.includes("disable screen") ||
            transcript.includes("end screen share")
          ) {
            if (!shouldDebounce("screen_off")) {
              onCommandDetectedRef.current?.(`Screen Off: "${transcript}"`);
              onScreenOffRef.current?.();
            }
            return;
          }

          // 6. Camera Deactivation triggers
          if (
            transcript.includes("camera off") ||
            transcript.includes("stop camera") ||
            transcript.includes("close camera") ||
            transcript.includes("turn off camera") ||
            transcript.includes("disable camera") ||
            transcript.includes("stop webcam") ||
            transcript.includes("webcam off") ||
            transcript.includes("turn off webcam")
          ) {
            if (!shouldDebounce("camera_off")) {
              onCommandDetectedRef.current?.(`Camera Off: "${transcript}"`);
              onCameraOffRef.current?.();
            }
            return;
          }

          // 7. General Vision Off
          if (
            transcript.includes("stop vision") ||
            transcript.includes("vision off") ||
            transcript.includes("turn off vision") ||
            transcript.includes("close vision") ||
            transcript.includes("disable vision")
          ) {
            if (!shouldDebounce("vision_off")) {
              onCommandDetectedRef.current?.(`Vision Off: "${transcript}"`);
              onCameraOffRef.current?.();
              onScreenOffRef.current?.();
            }
            return;
          }

          // 8. Session Disconnect / Sleep commands
          if (
            transcript.includes("go to sleep") ||
            transcript.includes("sleep now") ||
            transcript.includes("goodbye") ||
            transcript.includes("disconnect assistant") ||
            transcript.includes("stop listening") ||
            transcript.includes("shut down") ||
            transcript.includes("end session") ||
            transcript.includes("bye friday") ||
            transcript.includes("bye jarvis") ||
            transcript.includes("disconnect voice")
          ) {
            if (!shouldDebounce("sleep_session")) {
              onCommandDetectedRef.current?.(`Sleep Command: "${transcript}"`);
              if (isSessionActiveRef.current) {
                onDisconnectSessionRef.current?.();
              }
            }
            return;
          }

          // 9. Microphone Mute / Unmute
          if (
            transcript.includes("mute microphone") ||
            transcript.includes("mute mic") ||
            transcript.includes("mute audio") ||
            transcript.includes("mic off")
          ) {
            if (!shouldDebounce("mute_mic")) {
              onCommandDetectedRef.current?.(`Mute Mic: "${transcript}"`);
              onToggleMuteRef.current?.(true);
            }
            return;
          }
          if (
            transcript.includes("unmute microphone") ||
            transcript.includes("unmute mic") ||
            transcript.includes("unmute audio") ||
            transcript.includes("mic on")
          ) {
            if (!shouldDebounce("unmute_mic")) {
              onCommandDetectedRef.current?.(`Unmute Mic: "${transcript}"`);
              onToggleMuteRef.current?.(false);
            }
            return;
          }

          // 10. Interruption / Stop Talking
          if (
            transcript.includes("stop talking") ||
            transcript.includes("be quiet") ||
            transcript.includes("silence") ||
            transcript.includes("hold on") ||
            transcript.includes("pause")
          ) {
            if (!shouldDebounce("interrupt")) {
              onCommandDetectedRef.current?.(`Interrupt: "${transcript}"`);
              onInterruptRef.current?.();
            }
            return;
          }
        }
      };

      recognition.onerror = (event: any) => {
        // Only permanently block on explicit user permission denial
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          console.warn("Speech recognition permission denied.");
          hasErrorRef.current = true;
          try {
            recognition.stop();
          } catch (e) {}
        }
      };

      recognition.onend = () => {
        if (!isStoppedExplicitly && isEnabled && !hasErrorRef.current) {
          if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = setTimeout(() => {
            try {
              recognition.start();
            } catch (e) {
              // Recognition already active or starting
            }
          }, 350);
        }
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch (e) {
        // already started
      }
    } catch (e) {
      console.warn("Speech recognition initialization error:", e);
    }

    return () => {
      isStoppedExplicitly = true;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, [isEnabled]);
}
