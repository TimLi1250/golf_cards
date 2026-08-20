import { EventEmitter } from "node:events";
import type { ChatMessage } from "../chat";

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

export function publishPresenceUpdate(inviteCode: string, playerIds: string[]): void {
  roomEvents.emit("presence:update", inviteCode, playerIds);
}

export function publishLobbyChat(message: ChatMessage): void {
  roomEvents.emit("chat:lobby", message);
}

export function publishRoomChat(inviteCode: string, message: ChatMessage): void {
  roomEvents.emit("chat:room", inviteCode.toUpperCase(), message);
}
