import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  discardDrawnStockCard,
  drawFromStock,
  knock,
  peekInitialCards,
  replaceLayoutCard,
  startNextHole,
  takeDiscard,
  createMatch,
} from "../golf/engine";
import type { Card, MatchState } from "../golf/engine";
import type { GameAction, GameView, PublicCard } from "../golf/protocol";
import { PublicRoom, Room, RoomError, RoomPlayer } from "./registry";

type RoomRow = {
  id: string;
  invite_code: string;
  name: string;
  host: string;
  player_limit: number;
  status: Room["status"];
  created_at: string;
};

type PlayerRow = {
  id: string;
  name: string;
  joined_at: string;
};

/**
 * SQLite-backed room storage. It mirrors the in-memory RoomRegistry API so a
 * managed Postgres implementation can later be swapped in without touching
 * the HTTP routes or client lobby.
 */
export class SqliteRoomRegistry {
  private readonly database: DatabaseSync;

  constructor(databasePath = process.env.FAIRWAY_FOUR_DB_PATH || resolve(process.cwd(), "data", "fairway-four.sqlite")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  create(input: { host: string; hostId: string; name?: string; playerLimit: number }): PublicRoom {
    const host = cleanText(input.host, "Guest player", 24);
    const hostId = cleanText(input.hostId, "", 100);
    const name = cleanText(input.name, "Friday Scramble", 30);
    if (!hostId) throw new RoomError("A player session is required to host a game.");
    if (!Number.isInteger(input.playerLimit) || input.playerLimit < 2 || input.playerLimit > 12) {
      throw new RoomError("Tables can have between two and twelve players.");
    }

    const id = randomUUID();
    const inviteCode = this.nextInviteCode();
    const createdAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO rooms (id, invite_code, name, host, player_limit, status, created_at) VALUES (?, ?, ?, ?, ?, 'lobby', ?)")
        .run(id, inviteCode, name, host, input.playerLimit, createdAt);
      this.database.prepare("INSERT INTO room_players (room_id, id, name, joined_at) VALUES (?, ?, ?, ?)")
        .run(id, hostId, host, createdAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.get(inviteCode);
  }

  list(): PublicRoom[] {
    const rows = this.database.prepare("SELECT * FROM rooms WHERE status = 'lobby' ORDER BY created_at DESC").all() as unknown as RoomRow[];
    return rows.map((row) => this.mapRoom(row));
  }

  get(inviteCode: string): PublicRoom {
    return this.mapRoom(this.requireRoom(inviteCode));
  }

  join(inviteCode: string, input: { playerId: string; playerName: string }): PublicRoom {
    const playerId = cleanText(input.playerId, "", 100);
    const playerName = cleanText(input.playerName, "Guest player", 24);
    if (!playerId) throw new RoomError("A player session is required to join a game.");

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const room = this.requireRoom(inviteCode);
      if (room.status !== "lobby") throw new RoomError("This game is no longer accepting players.");
      const existing = this.database.prepare("SELECT id FROM room_players WHERE room_id = ? AND id = ?").get(room.id, playerId);
      if (existing) {
        this.database.prepare("UPDATE room_players SET name = ? WHERE room_id = ? AND id = ?").run(playerName, room.id, playerId);
      } else {
        const playerCount = this.database.prepare("SELECT COUNT(*) AS count FROM room_players WHERE room_id = ?").get(room.id) as unknown as { count: number };
        if (playerCount.count >= room.player_limit) throw new RoomError("This table is already full.");
        this.database.prepare("INSERT INTO room_players (room_id, id, name, joined_at) VALUES (?, ?, ?, ?)").run(room.id, playerId, playerName, new Date().toISOString());
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.get(inviteCode);
  }

  close(): void {
    this.database.close();
  }

  healthCheck(): boolean {
    const result = this.database.prepare("SELECT 1 AS healthy").get() as unknown as { healthy: number };
    return result.healthy === 1;
  }

  startGame(inviteCode: string, playerId: string): GameView {
    const room = this.requireRoom(inviteCode);
    const players = this.playersFor(room.id);
    if (room.status !== "lobby") throw new RoomError("This table has already started.");
    if (players[0]?.id !== playerId) throw new RoomError("Only the host can start this game.");
    if (players.length < 2) throw new RoomError("At least two players are needed to start.");

    const match = createMatch(players.map((player) => player.name));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE rooms SET status = 'playing' WHERE id = ?").run(room.id);
      this.database.prepare("INSERT INTO room_games (room_id, game_state) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET game_state = excluded.game_state")
        .run(room.id, JSON.stringify(match));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.gameView(inviteCode, playerId);
  }

  gameView(inviteCode: string, playerId: string): GameView {
    const room = this.requireRoom(inviteCode);
    const players = this.playersFor(room.id);
    const roomView = {
      inviteCode: room.invite_code,
      name: room.name,
      status: room.status,
      playerLimit: room.player_limit,
      players: players.map((player) => ({ id: player.id, name: player.name })),
    };
    const viewerIndex = players.findIndex((player) => player.id === playerId);
    const canStart = room.status === "lobby" && players[0]?.id === playerId;
    const storedGame = this.database.prepare("SELECT game_state FROM room_games WHERE room_id = ?").get(room.id) as unknown as { game_state: string } | undefined;
    if (!storedGame) return { room: roomView, canStart };

    const match = JSON.parse(storedGame.game_state) as MatchState;
    const revealed = match.hole.status === "scored";
    const viewerEngineId = viewerIndex === -1 ? undefined : `player-${viewerIndex + 1}`;
    const currentEnginePlayer = match.players[match.hole.currentPlayerIndex];
    const currentIndex = currentEnginePlayer ? match.players.findIndex((player) => player.id === currentEnginePlayer.id) : -1;
    const currentRoomPlayer = players[currentIndex];
    const viewerCanAct = match.hole.status === "playing" && currentEnginePlayer?.id === viewerEngineId;
    const viewPlayers = players.map((player, index) => {
      const enginePlayerId = `player-${index + 1}`;
      const layout = match.hole.layouts[enginePlayerId] ?? [];
      return {
        id: player.id,
        name: player.name,
        isYou: player.id === playerId,
        cardCount: layout.length,
        cards: layout.map((card) => (revealed ? publicCard(card) : null)),
        score: revealed ? match.hole.scores?.[enginePlayerId] : undefined,
      };
    });

    const phase = match.status === "finished" ? "finished" : match.hole.status;
    const discard = match.hole.discard.at(-1);
    if (!discard) throw new RoomError("Game state is missing a discard card.");
    return {
      room: roomView,
      canStart,
      game: {
        holeNumber: match.hole.number,
        holesToPlay: match.holesToPlay,
        phase,
        currentPlayerId: currentRoomPlayer?.id,
        currentPlayerName: currentRoomPlayer?.name,
        stockCount: match.hole.stock.length,
        discard: publicCard(discard),
        heldCard: viewerCanAct && match.hole.heldCard ? publicCard(match.hole.heldCard.card) : undefined,
        heldCardSource: viewerCanAct ? match.hole.heldCard?.source : undefined,
        canPeek: viewerEngineId ? !match.hole.peekedPlayerIds.includes(viewerEngineId) : false,
        canAct: viewerCanAct,
        knockerName: match.hole.knockerId ? match.players.find((player) => player.id === match.hole.knockerId)?.name : undefined,
        players: viewPlayers,
      },
    };
  }

  act(inviteCode: string, roomPlayerId: string, action: Exclude<GameAction, { type: "start" }>): { view: GameView; privatePeek?: PublicCard[] } {
    const room = this.requireRoom(inviteCode);
    if (room.status !== "playing") throw new RoomError("This game has not started.");
    const players = this.playersFor(room.id);
    const playerIndex = players.findIndex((player) => player.id === roomPlayerId);
    if (playerIndex === -1) throw new RoomError("Join this game before taking an action.");
    const enginePlayerId = `player-${playerIndex + 1}`;
    const storedGame = this.database.prepare("SELECT game_state FROM room_games WHERE room_id = ?").get(room.id) as unknown as { game_state: string } | undefined;
    if (!storedGame) throw new RoomError("Game state could not be found.");
    const match = JSON.parse(storedGame.game_state) as MatchState;
    let privatePeek: PublicCard[] | undefined;

    switch (action.type) {
      case "peek": privatePeek = peekInitialCards(match, enginePlayerId).map(publicCard); break;
      case "draw-stock": drawFromStock(match, enginePlayerId); break;
      case "take-discard": takeDiscard(match, enginePlayerId); break;
      case "replace": replaceLayoutCard(match, enginePlayerId, action.layoutIndex); break;
      case "discard-drawn": discardDrawnStockCard(match, enginePlayerId); break;
      case "knock": knock(match, enginePlayerId); break;
      case "next-hole": startNextHole(match); break;
    }
    this.saveMatch(room.id, match);
    return { view: this.gameView(inviteCode, roomPlayerId), privatePeek };
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        invite_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        player_limit INTEGER NOT NULL CHECK (player_limit BETWEEN 2 AND 12),
        status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'finished')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS room_players (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_id, id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS room_players_by_room ON room_players(room_id);
      CREATE TABLE IF NOT EXISTS room_games (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
        game_state TEXT NOT NULL
      ) STRICT;
    `);
  }

  private requireRoom(inviteCode: string): RoomRow {
    const room = this.database.prepare("SELECT * FROM rooms WHERE invite_code = ?").get(inviteCode.trim().toUpperCase()) as unknown as RoomRow | undefined;
    if (!room) throw new RoomError("No open table was found with that invite code.");
    return room;
  }

  private mapRoom(row: RoomRow): PublicRoom {
    const players = this.playersFor(row.id);
    return {
      id: row.id,
      inviteCode: row.invite_code,
      name: row.name,
      host: row.host,
      playerLimit: row.player_limit,
      status: row.status,
      createdAt: row.created_at,
      players,
    };
  }

  private playersFor(roomId: string): RoomPlayer[] {
    const players = this.database.prepare("SELECT id, name, joined_at FROM room_players WHERE room_id = ? ORDER BY joined_at ASC").all(roomId) as unknown as PlayerRow[];
    return players.map((player): RoomPlayer => ({ id: player.id, name: player.name, joinedAt: player.joined_at }));
  }

  private saveMatch(roomId: string, match: MatchState): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE room_games SET game_state = ? WHERE room_id = ?").run(JSON.stringify(match), roomId);
      if (match.status === "finished") this.database.prepare("UPDATE rooms SET status = 'finished' WHERE id = ?").run(roomId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private nextInviteCode(): string {
    let code = "";
    do {
      code = randomBytes(6).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    } while (code.length < 6 || this.database.prepare("SELECT 1 FROM rooms WHERE invite_code = ?").get(code));
    return code;
  }
}

function cleanText(value: string | undefined, fallback: string, maxLength: number): string {
  const cleaned = value?.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned || fallback;
}

function publicCard(card: Card): PublicCard {
  return { rank: card.rank, suit: card.suit };
}

declare global {
  var fairwayFourRoomRegistry: SqliteRoomRegistry | undefined;
  var fairwayFourRoomRegistryVersion: number | undefined;
}

export function persistentRoomRegistry(): SqliteRoomRegistry {
  const registryVersion = 2;
  if (globalThis.fairwayFourRoomRegistryVersion !== registryVersion || !globalThis.fairwayFourRoomRegistry) {
    const oldRegistry = globalThis.fairwayFourRoomRegistry as { close?: unknown } | undefined;
    if (typeof oldRegistry?.close === "function") oldRegistry.close();
    globalThis.fairwayFourRoomRegistry = new SqliteRoomRegistry();
    globalThis.fairwayFourRoomRegistryVersion = registryVersion;
  }
  return globalThis.fairwayFourRoomRegistry;
}
