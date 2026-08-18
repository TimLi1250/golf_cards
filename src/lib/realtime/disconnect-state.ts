declare global {
  var fairwayFourDisconnectDeadlines: Map<string, number> | undefined;
}

const deadlines = globalThis.fairwayFourDisconnectDeadlines ?? new Map<string, number>();
globalThis.fairwayFourDisconnectDeadlines = deadlines;

function disconnectKey(inviteCode: string, playerId: string): string {
  return `${inviteCode.toUpperCase()}:${playerId}`;
}

export function setDisconnectDeadline(inviteCode: string, playerId: string, deadline: number): void {
  deadlines.set(disconnectKey(inviteCode, playerId), deadline);
}

export function clearDisconnectDeadline(inviteCode: string, playerId: string): void {
  deadlines.delete(disconnectKey(inviteCode, playerId));
}

export function disconnectDeadline(inviteCode: string, playerId: string): number | undefined {
  return deadlines.get(disconnectKey(inviteCode, playerId));
}

export function roomDisconnectDeadlines(inviteCode: string): Record<string, number> {
  const prefix = `${inviteCode.toUpperCase()}:`;
  return Object.fromEntries([...deadlines.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, deadline]) => [key.slice(prefix.length), deadline]));
}
