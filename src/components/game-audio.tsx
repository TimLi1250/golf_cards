"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type GameAudioProps = {
  playing: boolean;
};

const MUSIC_NOTES = [329.63, 392, 493.88, 392, 293.66, 392, 440, 392];
const BASS_NOTES = [82.41, 82.41, 98, 98, 73.42, 73.42, 82.41, 82.41];

/** Synthesized game audio avoids network-loaded audio files and works offline. */
export default function GameAudio({ playing }: GameAudioProps) {
  const context = useRef<AudioContext | undefined>(undefined);
  const musicTimer = useRef<number | undefined>(undefined);
  const noteIndex = useRef(0);
  const enabledRef = useRef(true);
  const playingRef = useRef(playing);
  const [enabled, setEnabled] = useState(true);
  const [preferenceReady, setPreferenceReady] = useState(false);

  const stopMusic = useCallback(() => {
    if (musicTimer.current) window.clearInterval(musicTimer.current);
    musicTimer.current = undefined;
  }, []);

  const playTone = useCallback((frequency: number, duration: number, volume: number, type: OscillatorType = "square") => {
    const audio = context.current;
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
    if (musicTimer.current || !enabledRef.current || !playingRef.current) return;
    const playStep = () => {
      const index = noteIndex.current % MUSIC_NOTES.length;
      playTone(MUSIC_NOTES[index], 0.23, 0.018);
      if (index % 2 === 0) playTone(BASS_NOTES[index], 0.3, 0.011, "triangle");
      noteIndex.current += 1;
    };
    playStep();
    musicTimer.current = window.setInterval(playStep, 360);
  }, [playTone]);

  const unlockAudio = useCallback(async () => {
    if (!enabledRef.current) return;
    if (!context.current || context.current.state === "closed") context.current = new AudioContext();
    try {
      await context.current.resume();
      if (playingRef.current) startMusic();
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
    else if (playing && context.current?.state === "running") startMusic();
  }, [enabled, playing, preferenceReady, startMusic, stopMusic]);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) stopMusic();
    else if (enabledRef.current && context.current?.state === "running") startMusic();
  }, [playing, startMusic, stopMusic]);

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
      void context.current?.close();
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
