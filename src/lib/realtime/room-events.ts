import { EventEmitter } from "node:events";
import type { ChatMessage } from "../chat";

export type MatchTravelEvent = {
  id: string;
  playerId: string;
  targetPlayerId: string;
  layoutIndex: number;
  durationMs: number;
};

export type MatchResultEvent = {
  id: string;
  playerName: string;
  outcome: "safe" | "out";
  durationMs: number;
};

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

export function publishMatchTravel(inviteCode: string, event: MatchTravelEvent): void {
  roomEvents.emit("match:travel", inviteCode.toUpperCase(), event);
}

export function publishMatchResult(inviteCode: string, event: MatchResultEvent): void {
  roomEvents.emit("match:result", inviteCode.toUpperCase(), event);
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
