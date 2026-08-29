import { EventEmitter } from "node:events";
import type { ChatMessage } from "../chat";

type GameEventBase = {
  id: string;
  occurredAt: number;
  durationMs: number;
};

export type RealtimeGameEvent = GameEventBase & (
  | {
    type: "swap:travel";
    payload: { cards: { playerId: string; layoutIndex: number }[]; travelDurationMs: number };
  }
  | {
    type: "match:travel";
    payload: { playerId: string; targetPlayerId: string; layoutIndex: number };
  }
  | {
    type: "match:result";
    payload: { playerName: string; outcome: "safe" | "out" };
  }
);

declare global {
  var fairwayFourRoomEvents: EventEmitter | undefined;
}

export const roomEvents = globalThis.fairwayFourRoomEvents ?? new EventEmitter();
globalThis.fairwayFourRoomEvents = roomEvents;

export function publishLobbyUpdate(): void {
  roomEvents.emit("lobby:update");
}

export function publishRoomUpdate(inviteCode: string): void {
  roomEvents.emit("room:update", inviteCode);
}

export function publishGameEvent(inviteCode: string, event: RealtimeGameEvent): void {
  roomEvents.emit("game:event", inviteCode.toUpperCase(), event);
}

export function publishPresenceUpdate(inviteCode: string, playerIds: string[]): void {
  roomEvents.emit("presence:update", inviteCode, playerIds);
}

export function publishLobbyChat(message: ChatMessage): void {
  roomEvents.emit("chat:lobby", message);
}

export function publishRoomChat(inviteCode: string, message: ChatMessage): void {
  roomEvents.emit("chat:room", inviteCode.toUpperCase(), message);
}
