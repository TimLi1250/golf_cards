let sharedAudioContext: AudioContext | undefined;

/** Returns one app-wide audio context so a user gesture can unlock music after navigation. */
export function appAudioContext(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") sharedAudioContext = new AudioContext();
  return sharedAudioContext;
}

export function closeAppAudioContext(): void {
  void sharedAudioContext?.close();
  sharedAudioContext = undefined;
}
