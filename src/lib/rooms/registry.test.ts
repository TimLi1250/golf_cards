import assert from "node:assert/strict";
import test from "node:test";
import { RoomError, RoomRegistry } from "./registry";

test("creates a lobby room with the host seated", () => {
  const registry = new RoomRegistry();
  const room = registry.create({ host: "Avery", hostId: "player-a", name: "Lunch golf", playerLimit: 4 });
  assert.equal(room.name, "Lunch golf");
  assert.equal(room.players.length, 1);
  assert.equal(room.players[0].name, "Avery");
  assert.match(room.inviteCode, /^[A-Z0-9]{6}$/);
});

test("joins available rooms once per player session and enforces capacity", () => {
  const registry = new RoomRegistry();
  const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 2 });
  assert.equal(registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" }).players.length, 2);
  assert.equal(registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake B" }).players.length, 2);
  assert.throws(() => registry.join(room.inviteCode, { playerId: "player-c", playerName: "Casey" }), RoomError);
});

test("requires the invite code for private tables", () => {
  const registry = new RoomRegistry();
  const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 3, isPrivate: true });
  assert.equal(room.isPrivate, true);
  assert.throws(() => registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" }), RoomError);
  assert.equal(registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake", accessCode: room.inviteCode }).players.length, 2);
});
