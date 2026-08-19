"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appAudioContext } from "../lib/browser-audio";

type GameAudioProps = {
  active: boolean;
  knock: boolean;
};

const MUSIC_NOTES = [659.25, 783.99, 987.77, 783.99, 659.25, 587.33, 659.25, 739.99, 880, 987.77, 880, 783.99, 659.25, 587.33, 493.88, 587.33];
const BASS_NOTES = [164.81, 164.81, 164.81, 164.81, 146.83, 146.83, 146.83, 146.83, 130.81, 130.81, 130.81, 130.81, 146.83, 146.83, 164.81, 164.81];
const HARMONY_NOTES = [0, 0, 0, 0, 493.88, 0, 0, 0, 659.25, 0, 0, 0, 587.33, 0, 0, 0];

/** Synthesized game audio avoids network-loaded audio files and works offline. */
export default function GameAudio({ active, knock }: GameAudioProps) {
  const musicTimer = useRef<number | undefined>(undefined);
  const noteIndex = useRef(0);
  const enabledRef = useRef(true);
  const activeRef = useRef(active);
  const knockRef = useRef(knock);
  const [enabled, setEnabled] = useState(true);
  const [preferenceReady, setPreferenceReady] = useState(false);

  const stopMusic = useCallback(() => {
    if (musicTimer.current) window.clearInterval(musicTimer.current);
    musicTimer.current = undefined;
  }, []);

  const playTone = useCallback((frequency: number, duration: number, volume: number, type: OscillatorType = "square") => {
    const audio = appAudioContext();
    if (!audio || audio.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }, []);

  const startMusic = useCallback(() => {
    if (musicTimer.current || !enabledRef.current || !activeRef.current) return;
    const playStep = () => {
      const index = noteIndex.current % MUSIC_NOTES.length;
      const fast = knockRef.current;
      playTone(MUSIC_NOTES[index], fast ? 0.15 : 0.22, fast ? 0.022 : 0.018);
      if (index % 2 === 0) playTone(BASS_NOTES[index], fast ? 0.2 : 0.28, fast ? 0.017 : 0.011, "triangle");
      if (HARMONY_NOTES[index]) playTone(HARMONY_NOTES[index], fast ? 0.13 : 0.19, 0.009, "square");
      noteIndex.current += 1;
    };
    playStep();
    musicTimer.current = window.setInterval(playStep, knockRef.current ? 205 : 300);
  }, [playTone]);

  const unlockAudio = useCallback(async () => {
    if (!enabledRef.current) return;
    const audio = appAudioContext();
    if (!audio) return;
    try {
      await audio.resume();
      if (activeRef.current) startMusic();
    } catch {
      // Audio is optional. Some browsers can reject sound while backgrounded.
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
    else if (active && appAudioContext()?.state === "running") startMusic();
  }, [active, enabled, preferenceReady, startMusic, stopMusic]);

  useEffect(() => {
    activeRef.current = active;
    knockRef.current = knock;
    stopMusic();
    if (active && enabledRef.current && appAudioContext()?.state === "running") startMusic();
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
      stopMusic();
    };
  }, [stopMusic, unlockAudio]);

  function toggleSound() {
    setEnabled((current) => {
      const next = !current;
      window.dispatchEvent(new CustomEvent("golf-sound-change", { detail: next }));
      return next;
    });
  }

  return <button type="button" className="sound-toggle" data-audio-control="true" aria-pressed={enabled} onClick={toggleSound}>{enabled ? "SOUND: ON" : "SOUND: OFF"}</button>;
}
