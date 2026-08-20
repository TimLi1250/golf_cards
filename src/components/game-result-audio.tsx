"use client";

import { useEffect, useRef } from "react";

type GameResultAudioProps = {
  active: boolean;
  won: boolean;
};

/** Plays a private final-result sound when the nine-hole game is complete. */
export default function GameResultAudio({ active, won }: GameResultAudioProps) {
  const winSound = useRef<HTMLAudioElement | undefined>(undefined);
  const loseSound = useRef<HTMLAudioElement | undefined>(undefined);
  const played = useRef(false);

  useEffect(() => {
    winSound.current = new Audio("/game-win.mp3");
    loseSound.current = new Audio("/game-lose.mp3");
    winSound.current.preload = "auto";
    loseSound.current.preload = "auto";
    winSound.current.volume = 0.55;
    loseSound.current.volume = 0.55;
    return () => {
      winSound.current?.pause();
      loseSound.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      played.current = false;
      return;
    }
    if (played.current || window.localStorage.getItem("golf-sound-enabled") === "false") return;
    played.current = true;
    const sound = won ? winSound.current : loseSound.current;
    if (!sound) return;
    sound.currentTime = 0;
    void sound.play().catch(() => {
      // A browser may require an earlier player interaction before audio can play.
    });
  }, [active, won]);

  return null;
}
