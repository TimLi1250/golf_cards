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
    assert.equal(started.game?.discard, null);
    assert.equal(started.game?.canMatch, false);
    assert.deepEqual(started.game?.players[0].cards, [null, null, null, null]);

    const peek = registry.act(room.inviteCode, "player-a", { type: "peek" });
    assert.equal(peek.privatePeek?.length, 2);
    assert.deepEqual(peek.view!.game?.players[0].cards, [null, null, null, null]);

    const ready = registry.act(room.inviteCode, "player-b", { type: "peek" });
    assert.equal(ready.view.game?.canAct, true);
    assert.equal(ready.view.game?.discard, null);
    assert.equal(ready.view.game?.canMatch, false);

    const drawn = registry.act(room.inviteCode, "player-b", { type: "draw-stock" });
    assert.ok(drawn.view!.game?.heldCard);
    let afterReplacement = registry.act(room.inviteCode, "player-b", { type: "replace", layoutIndex: 0 });
    if (afterReplacement.view.game?.canUsePower) afterReplacement = registry.act(room.inviteCode, "player-b", { type: "skip-power" });
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

test("eliminates a player who calls a wrong match while the other players continue", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-wrong-match-"));
  const databasePath = join(directory, "rooms.sqlite");
  const registry = new SqliteRoomRegistry(databasePath);
  try {
    const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 3 });
    registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" });
    registry.join(room.inviteCode, { playerId: "player-c", playerName: "Casey" });
    registry.startGame(room.inviteCode, "player-a");

    const database = new DatabaseSync(databasePath);
    const stored = database.prepare("SELECT game_state FROM room_games WHERE room_id = ?").get(room.id) as { game_state: string };
    const match = JSON.parse(stored.game_state) as { players: { id: string }[]; hole: { peekedPlayerIds: string[]; discard: unknown[]; layouts: Record<string, unknown[]> } };
    match.hole.peekedPlayerIds = match.players.map((player) => player.id);
    match.hole.discard = [{ id: "discard-5", rank: "5", suit: "clubs" }];
    match.hole.layouts["player-2"][0] = { id: "wrong-4", rank: "4", suit: "hearts" };
    database.prepare("UPDATE room_games SET game_state = ? WHERE room_id = ?").run(JSON.stringify(match), room.id);
    database.close();

    const wrongGuess = registry.act(room.inviteCode, "player-b", { type: "match-own", layoutIndex: 0 });
    assert.equal(wrongGuess.privateSelfReveal?.length, 4);
    assert.equal(wrongGuess.privateSelfReveal?.[0]?.rank, "4");
    assert.deepEqual(wrongGuess.view.game?.players.find((player) => player.name === "Blake")?.cards, [null, null, null, null]);
    assert.deepEqual(registry.get(room.inviteCode).players.map((player) => player.name), ["Avery", "Blake", "Casey"]);
    const remainingView = registry.gameView(room.inviteCode, "player-a");
    assert.equal(remainingView.game?.phase, "playing");
    assert.equal(remainingView.game?.currentPlayerName, "Casey");
    assert.equal(remainingView.game?.players.find((player) => player.name === "Blake")?.isOut, true);
    assert.deepEqual(remainingView.game?.players.find((player) => player.name === "Blake")?.cards, [null, null, null, null]);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("privately reveals only the caller's cards after a wrong opponent match", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-wrong-opponent-match-"));
  const databasePath = join(directory, "rooms.sqlite");
  const registry = new SqliteRoomRegistry(databasePath);
  try {
    const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 3 });
    registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" });
    registry.join(room.inviteCode, { playerId: "player-c", playerName: "Casey" });
    registry.startGame(room.inviteCode, "player-a");

    const database = new DatabaseSync(databasePath);
    const stored = database.prepare("SELECT game_state FROM room_games WHERE room_id = ?").get(room.id) as { game_state: string };
    const match = JSON.parse(stored.game_state) as { players: { id: string }[]; hole: { peekedPlayerIds: string[]; discard: unknown[]; layouts: Record<string, unknown[]> } };
    match.hole.peekedPlayerIds = match.players.map((player) => player.id);
    match.hole.discard = [{ id: "discard-5", rank: "5", suit: "clubs" }];
    match.hole.layouts["player-1"][0] = { id: "wrong-target", rank: "K", suit: "spades" };
    match.hole.layouts["player-2"] = [
      { id: "caller-a", rank: "A", suit: "clubs" },
      { id: "caller-2", rank: "2", suit: "diamonds" },
      { id: "caller-3", rank: "3", suit: "hearts" },
      { id: "caller-4", rank: "4", suit: "spades" },
    ];
    database.prepare("UPDATE room_games SET game_state = ? WHERE room_id = ?").run(JSON.stringify(match), room.id);
    database.close();

    const wrongGuess = registry.act(room.inviteCode, "player-b", { type: "claim-other-match", targetPlayerId: "player-a", layoutIndex: 0 });
    assert.deepEqual(wrongGuess.privateSelfReveal?.map((card) => card?.rank), ["A", "2", "3", "4"]);
    assert.deepEqual(wrongGuess.view.game?.players.find((player) => player.name === "Avery")?.cards, [null, null, null, null]);
    assert.deepEqual(wrongGuess.view.game?.players.find((player) => player.name === "Blake")?.cards, [null, null, null, null]);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("warns only the host before removing an inactive table", () => {
  const directory = mkdtempSync(join(tmpdir(), "fairway-four-inactive-"));
  const databasePath = join(directory, "rooms.sqlite");
  const registry = new SqliteRoomRegistry(databasePath);
  try {
    const room = registry.create({ host: "Avery", hostId: "player-a", playerLimit: 2 });
    registry.join(room.inviteCode, { playerId: "player-b", playerName: "Blake" });
    registry.startGame(room.inviteCode, "player-a");
    const now = Date.now();
    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE room_games SET last_activity_at = ? WHERE room_id = ?").run(now - 180_001, room.id);

    assert.deepEqual(registry.sweepInactiveTables(now), { warnedInviteCodes: [room.inviteCode], removedInviteCodes: [] });
    assert.equal(registry.gameView(room.inviteCode, "player-a").game?.inactivityDeadline, now + 30_000);
    assert.equal(registry.gameView(room.inviteCode, "player-b").game?.inactivityDeadline, undefined);
    assert.throws(() => registry.confirmTableActive(room.inviteCode, "player-b", now + 1_000));
    assert.equal(registry.confirmTableActive(room.inviteCode, "player-a", now + 1_000).game?.inactivityDeadline, undefined);

    database.prepare("UPDATE room_games SET last_activity_at = ? WHERE room_id = ?").run(now - 180_001, room.id);
    registry.sweepInactiveTables(now);
    registry.act(room.inviteCode, "player-a", { type: "peek" });
    assert.equal(registry.gameView(room.inviteCode, "player-a").game?.inactivityDeadline, undefined);

    database.prepare("UPDATE room_games SET last_activity_at = ?, inactivity_deadline = NULL WHERE room_id = ?").run(now - 180_001, room.id);
    registry.sweepInactiveTables(now);
    assert.throws(() => registry.confirmTableActive(room.inviteCode, "player-a", now + 30_000));
    assert.deepEqual(registry.sweepInactiveTables(now + 30_000), { warnedInviteCodes: [], removedInviteCodes: [room.inviteCode] });
    assert.throws(() => registry.get(room.inviteCode));
    database.close();
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
