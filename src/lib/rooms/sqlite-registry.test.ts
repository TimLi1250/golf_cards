import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteRoomRegistry } from "./sqlite-registry";

test("persists rooms when a fresh registry opens the same database", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-"));
  const databasePath = join(directory, "rooms.sqlite");
  const firstRegistry = new SqliteRoomRegistry(databasePath);

  try {
    const created = firstRegistry.create({ host: "Avery", hostId: "player-a", name: "Night nine", playerLimit: 4 });
    firstRegistry.close();

    const secondRegistry = new SqliteRoomRegistry(databasePath);
    try {
      const restored = secondRegistry.get(created.inviteCode);
      assert.equal(restored.name, "Night nine");
      assert.equal(restored.players[0].name, "Avery");
    } finally {
      secondRegistry.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stores an authoritative game while keeping layout card faces private", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-game-"));
  const registry = new SqliteRoomRegistry(join(directory, "rooms.sqlite"));
  try {
    const room = registry.create({ host: "Avery", hostId: "player-a", name: "Night nine", playerLimit: 2 });
    registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" });
    const started = registry.startGame(room.inviteCode, "player-a");
    assert.equal(started.game?.phase, "playing");
    assert.deepEqual(started.game?.players[0].cards, [null, null, null, null]);

    const peek = registry.act(room.inviteCode, "player-a", { type: "peek" });
    assert.equal(peek.privatePeek?.length, 2);
    assert.deepEqual(peek.view.game?.players[0].cards, [null, null, null, null]);

    registry.act(room.inviteCode, "player-b", { type: "peek" });

    const drawn = registry.act(room.inviteCode, "player-b", { type: "draw-stock" });
    assert.ok(drawn.view.game?.heldCard);
    const afterReplacement = registry.act(room.inviteCode, "player-b", { type: "replace", layoutIndex: 0 });
    assert.equal(afterReplacement.view.game?.currentPlayerName, "Avery");
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("removes a departing player from an active game for every remaining player", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-active-leave-"));
  const registry = new SqliteRoomRegistry(join(directory, "rooms.sqlite"));
  try {
    const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 3 });
    registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" });
    registry.join(room.inviteCode, { playerId: "player-c", playerName: "Casey" });
    registry.startGame(room.inviteCode, "player-a");

    assert.deepEqual(registry.leave(room.inviteCode, "player-b"), { left: true, finished: false });
    const remainingView = registry.gameView(room.inviteCode, "player-a");
    assert.deepEqual(remainingView.room.players.map((player) => player.name), ["Avery", "Casey"]);
    assert.deepEqual(remainingView.game?.players.map((player) => player.name), ["Avery", "Casey"]);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("enforces private-table access codes", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-private-"));
  const registry = new SqliteRoomRegistry(join(directory, "rooms.sqlite"));
  try {
    const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 2, isPrivate: true, inviteCode: "SECRET" });
    assert.equal(room.isPrivate, true);
    assert.equal(room.inviteCode, "SECRET");
    assert.throws(() => registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" }));
    assert.equal(registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake", accessCode: "SECRET" }).players.length, 2);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("allows only the host to delete their specific table", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-host-delete-"));
  const registry = new SqliteRoomRegistry(join(directory, "rooms.sqlite"));
  try {
    const first = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 2 });
    const second = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 2 });
    const remaining = registry.create({ host: "Blake", hostId: "player-b", playerLimit: 2 });
    assert.equal(registry.closeHostedRoom(first.inviteCode, "player-b"), false);
    assert.equal(registry.closeHostedRoom(first.inviteCode, "player-a"), true);
    assert.equal(registry.leave(second.inviteCode, "player-a").left, true);
    assert.equal(registry.get(second.inviteCode).players.length, 0);
    assert.deepEqual(registry.knownPlayers(), [{ id: "player-a", name: "Avery" }, { id: "player-b", name: "Blake" }]);
    assert.equal(registry.closeHostedRoom(second.inviteCode, "player-a"), true);
    assert.deepEqual(new Set(registry.list().map((room) => room.inviteCode)), new Set([remaining.inviteCode]));
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrates existing room databases with private-table support", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-migration-"));
  const databasePath = join(directory, "rooms.sqlite");
  const oldDatabase = new DatabaseSync(databasePath);
  oldDatabase.exec("CREATE TABLE rooms (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, host TEXT NOT NULL, player_limit INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;");
  oldDatabase.close();
  const registry = new SqliteRoomRegistry(databasePath);
  try {
    const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 2, isPrivate: true });
    assert.equal(room.isPrivate, true);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
