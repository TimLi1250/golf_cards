"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appAudioContext } from "../lib/browser-audio";

const CLUBHOUSE_BGM_URL = "/clubhouse-bgm.mp3";

/** Loops the clubhouse track until the player enters a table. */
export default function ClubhouseAudio() {
  const music = useRef<HTMLAudioElement | undefined>(undefined);
  const enabledRef = useRef(true);
  const [enabled, setEnabled] = useState(true);
  const [preferenceReady, setPreferenceReady] = useState(false);

  const getMusic = useCallback(() => {
    if (!music.current) {
      music.current = new Audio(CLUBHOUSE_BGM_URL);
      music.current.loop = true;
      music.current.preload = "auto";
      music.current.volume = 0.28;
    }
    return music.current;
  }, []);

  const stopMusic = useCallback((reset = false) => {
    const track = music.current;
    if (!track) return;
    track.pause();
    if (reset) track.currentTime = 0;
  }, []);

  const startMusic = useCallback(() => {
    if (!enabledRef.current) return;
    void getMusic().play().catch(() => {
      // Browsers require a player interaction before background music can begin.
    });
  }, [getMusic]);

  const unlockAudio = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      await appAudioContext()?.resume();
      startMusic();
    } catch {
      // Sound remains optional if the browser blocks it while backgrounded.
    }
  }, [startMusic]);

  useEffect(() => {
    const stored = window.localStorage.getItem("golf-sound-enabled");
    const savedEnabled = stored !== "false";
    enabledRef.current = savedEnabled;
    const update = window.setTimeout(() => {
      setEnabled(savedEnabled);
      setPreferenceReady(true);
    }, 0);
    return () => window.clearTimeout(update);
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    if (preferenceReady) window.localStorage.setItem("golf-sound-enabled", String(enabled));
    if (enabled) startMusic();
    else stopMusic();
  }, [enabled, preferenceReady, startMusic, stopMusic]);

  useEffect(() => {
    const unlockOnInteraction = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target || target.disabled || target.dataset.audioControl === "true") return;
      void unlockAudio();
    };
    document.addEventListener("click", unlockOnInteraction);
    return () => {
      document.removeEventListener("click", unlockOnInteraction);
      stopMusic(true);
    };
  }, [stopMusic, unlockAudio]);

  function toggleSound() {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    window.dispatchEvent(new CustomEvent("golf-sound-change", { detail: next }));
    if (next) void unlockAudio();
  }

  return <button type="button" className="sound-toggle" data-audio-control="true" aria-pressed={enabled} onClick={toggleSound}>{enabled ? "SOUND: ON" : "SOUND: OFF"}</button>;
}
