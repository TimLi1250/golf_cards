"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appAudioContext } from "../lib/browser-audio";

type GameAudioProps = {
  active: boolean;
  knock: boolean;
};

const GAME_BGM_URL = "/game-bgm.mp3";

/** Plays the supplied BeepBox track locally, so it also works in the installed web app. */
export default function GameAudio({ active, knock }: GameAudioProps) {
  const music = useRef<HTMLAudioElement | undefined>(undefined);
  const enabledRef = useRef(true);
  const activeRef = useRef(active);
  const knockRef = useRef(knock);
  const [enabled, setEnabled] = useState(true);
  const [preferenceReady, setPreferenceReady] = useState(false);

  const getMusic = useCallback(() => {
    if (!music.current) {
      music.current = new Audio(GAME_BGM_URL);
      music.current.loop = true;
      music.current.preload = "auto";
      music.current.volume = 0.34;
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
    if (!enabledRef.current || !activeRef.current) return;
    const track = getMusic();
    track.playbackRate = knockRef.current ? 1.28 : 1;
    void track.play().catch(() => {
      // Mobile browsers require a game interaction before audio can begin.
    });
  }, [getMusic]);

  const unlockAudio = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      await appAudioContext()?.resume();
      startMusic();
    } catch {
      // Sound remains optional if the browser blocks audio while backgrounded.
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
    if (!enabled) stopMusic();
    else startMusic();
  }, [enabled, preferenceReady, startMusic, stopMusic]);

  useEffect(() => {
    activeRef.current = active;
    knockRef.current = knock;
    if (!active) {
      stopMusic(true);
      return;
    }
    if (music.current) music.current.playbackRate = knock ? 1.28 : 1;
    startMusic();
  }, [active, knock, startMusic, stopMusic]);

  useEffect(() => {
    const unlockOnGameInteraction = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target || target.disabled || target.dataset.audioControl === "true") return;
      void unlockAudio();
    };
    document.addEventListener("click", unlockOnGameInteraction);
    return () => {
      document.removeEventListener("click", unlockOnGameInteraction);
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
