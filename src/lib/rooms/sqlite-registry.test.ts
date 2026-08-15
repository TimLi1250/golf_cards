import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    const drawn = registry.act(room.inviteCode, "player-b", { type: "draw-stock" });
    assert.ok(drawn.view.game?.heldCard);
    const afterReplacement = registry.act(room.inviteCode, "player-b", { type: "replace", layoutIndex: 0 });
    assert.equal(afterReplacement.view.game?.currentPlayerName, "Avery");
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
