"use client";

import { useEffect, useRef } from "react";

/** A subtle UI click shared by the clubhouse, table lobby, and active game. */
export default function ButtonSounds() {
  const context = useRef<AudioContext | undefined>(undefined);
  const enabled = useRef(true);

  useEffect(() => {
    enabled.current = window.localStorage.getItem("golf-sound-enabled") !== "false";
    const updatePreference = (event: Event) => {
      enabled.current = (event as CustomEvent<boolean>).detail;
    };
    const playClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target || target.disabled || target.dataset.audioControl === "true" || !enabled.current) return;
      if (!context.current || context.current.state === "closed") context.current = new AudioContext();
      const audio = context.current;
      void audio.resume().then(() => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const now = audio.currentTime;
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(740, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.035, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.075);
      }).catch(() => undefined);
    };
    window.addEventListener("golf-sound-change", updatePreference);
    document.addEventListener("click", playClick);
    return () => {
      window.removeEventListener("golf-sound-change", updatePreference);
      document.removeEventListener("click", playClick);
      void context.current?.close();
    };
  }, []);

  return null;
}
