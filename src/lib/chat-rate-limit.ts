declare global {
  var golfChatRecentMessages: Map<string, number> | undefined;
}

const recentMessages = globalThis.golfChatRecentMessages ?? new Map<string, number>();
globalThis.golfChatRecentMessages = recentMessages;

/** Keeps a held key from flooding the small table chat without requiring extra infrastructure. */
export function canSendChat(channel: string, playerId: string, now = Date.now()): boolean {
  const key = `${channel}:${playerId}`;
  const previous = recentMessages.get(key) || 0;
  if (now - previous < 750) return false;
  recentMessages.set(key, now);
  if (recentMessages.size > 1_000) {
    for (const [entryKey, timestamp] of recentMessages) if (now - timestamp > 60_000) recentMessages.delete(entryKey);
  }
  return true;
}
