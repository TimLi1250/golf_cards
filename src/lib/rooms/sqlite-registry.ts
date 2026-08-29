import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  discardDrawnStockCard,
  keepDrawnCard,
  drawFromStock,
  claimOpponentMatch,
  completeSwapPower,
  eliminatePlayer,
  giveMatchCard,
  knock,
  finalizeKnock,
  matchDiscard,
  peekInitialCards,
  previewOpponentDiscardMatch,
  previewOwnDiscardMatch,
  replaceLayoutCard,
  removePlayer,
  skipPower,
  startNextHole,
  takeDiscard,
  resolvePeekPower,
  resolveSwapPower,
  createMatch,
} from "../golf/engine";
import type { Card, LayoutCardReference, MatchAttemptSnapshot, MatchEvent, MatchState } from "../golf/engine";
import type { GameAction, GameView, MatchAction, PublicCard } from "../golf/protocol";
import type { ChatMessage } from "../chat";
import { disconnectDeadline } from "../realtime/disconnect-state";
import { PublicRoom, Room, RoomError, RoomPlayer } from "./registry";

type RoomRow = {
  id: string;
  invite_code: string;
  name: string;
  host: string;
  host_player_id: string;
  player_limit: number;
  is_private: number;
  status: Room["status"];
  created_at: string;
};

type PlayerRow = {
  id: string;
  name: string;
  joined_at: string;
};

type PlayerProfileRow = {
  id: string;
  name: string;
};

type ChatMessageRow = {
  id: string;
  channel: "lobby" | "room";
  room_id: string | null;
  player_id: string;
  player_name: string;
  body: string;
  sent_at: number;
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

  create(input: { host: string; hostId: string; name?: string; playerLimit: number; isPrivate?: boolean; inviteCode?: string }): PublicRoom {
    const host = cleanText(input.host, "Guest player", 24);
    const hostId = cleanText(input.hostId, "", 100);
    const name = cleanText(input.name, "Friday Scramble", 30);
    if (!hostId) throw new RoomError("A player session is required to host a game.");
    if (!Number.isInteger(input.playerLimit) || input.playerLimit < 2 || input.playerLimit > 12) {
      throw new RoomError("Tables can have between two and twelve players.");
    }

    this.upsertPlayer(hostId, host);

    const id = randomUUID();
    const inviteCode = this.nextInviteCode(input.inviteCode);
    const createdAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO rooms (id, invite_code, name, host, host_player_id, player_limit, is_private, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'lobby', ?)")
        .run(id, inviteCode, name, host, hostId, input.playerLimit, Number(Boolean(input.isPrivate)), createdAt);
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
    const rows = this.database.prepare("SELECT * FROM rooms WHERE status != 'finished' ORDER BY created_at DESC").all() as unknown as RoomRow[];
    return rows.map((row) => this.mapRoom(row));
  }

  inviteCodes(): string[] {
    const rows = this.database.prepare("SELECT invite_code FROM rooms").all() as unknown as { invite_code: string }[];
    return rows.map((row) => row.invite_code);
  }

  upsertPlayer(playerId: string, playerName: string): void {
    const id = cleanText(playerId, "", 100);
    if (!id) return;
    const name = cleanText(playerName, "Guest", 24);
    this.database.prepare("INSERT INTO player_profiles (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").run(id, name);
  }

  knownPlayers(): { id: string; name: string }[] {
    const players = this.database.prepare("SELECT id, name FROM player_profiles ORDER BY name COLLATE NOCASE, id").all() as unknown as PlayerProfileRow[];
    return players.map((player) => ({ id: player.id, name: player.name }));
  }

  lobbyChat(): ChatMessage[] {
    const rows = this.database.prepare("SELECT * FROM chat_messages WHERE channel = 'lobby' ORDER BY sent_at DESC LIMIT 100").all() as unknown as ChatMessageRow[];
    return rows.reverse().map((row) => this.mapChatMessage(row));
  }

  roomChat(inviteCode: string, playerId: string): ChatMessage[] {
    const room = this.requireRoom(inviteCode);
    this.requireRoomPlayer(room.id, playerId);
    const rows = this.database.prepare("SELECT * FROM chat_messages WHERE channel = 'room' AND room_id = ? ORDER BY sent_at DESC LIMIT 100").all(room.id) as unknown as ChatMessageRow[];
    return rows.reverse().map((row) => this.mapChatMessage(row, room.invite_code));
  }

  postLobbyChat(input: { playerId: string; playerName: string; body: string }): ChatMessage {
    const playerId = cleanText(input.playerId, "", 100);
    if (!playerId) throw new RoomError("A player session is required to chat.");
    const playerName = cleanText(input.playerName, "Guest", 24);
    const body = cleanChatBody(input.body);
    this.upsertPlayer(playerId, playerName);
    const message: ChatMessage = { id: randomUUID(), channel: "lobby", playerId, playerName, body, sentAt: Date.now() };
    this.database.prepare("INSERT INTO chat_messages (id, channel, room_id, player_id, player_name, body, sent_at) VALUES (?, 'lobby', NULL, ?, ?, ?, ?)")
      .run(message.id, playerId, playerName, body, message.sentAt);
    this.trimChat("lobby");
    return message;
  }

  postRoomChat(inviteCode: string, input: { playerId: string; body: string }): ChatMessage {
    const room = this.requireRoom(inviteCode);
    const playerId = cleanText(input.playerId, "", 100);
    const player = this.requireRoomPlayer(room.id, playerId);
    const body = cleanChatBody(input.body);
    const message: ChatMessage = { id: randomUUID(), channel: "room", inviteCode: room.invite_code, playerId, playerName: player.name, body, sentAt: Date.now() };
    this.database.prepare("INSERT INTO chat_messages (id, channel, room_id, player_id, player_name, body, sent_at) VALUES (?, 'room', ?, ?, ?, ?, ?)")
      .run(message.id, room.id, playerId, player.name, body, message.sentAt);
    this.trimChat("room", room.id);
    return message;
  }

  playersInOpenTables(): Set<string> {
    const rows = this.database.prepare("SELECT DISTINCT room_players.id FROM room_players JOIN rooms ON rooms.id = room_players.room_id WHERE rooms.status != 'finished'").all() as unknown as { id: string }[];
    return new Set(rows.map((row) => row.id));
  }

  isRoomPlayer(inviteCode: string, playerId: string): boolean {
    try {
      const room = this.requireRoom(inviteCode);
      return Boolean(this.database.prepare("SELECT 1 FROM room_players WHERE room_id = ? AND id = ?").get(room.id, cleanText(playerId, "", 100)));
    } catch {
      return false;
    }
  }

  get(inviteCode: string): PublicRoom {
    return this.mapRoom(this.requireRoom(inviteCode));
  }

  join(inviteCode: string, input: { playerId: string; playerName: string; accessCode?: string }): PublicRoom {
    const playerId = cleanText(input.playerId, "", 100);
    const playerName = cleanText(input.playerName, "Guest player", 24);
    if (!playerId) throw new RoomError("A player session is required to join a game.");

    this.upsertPlayer(playerId, playerName);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const room = this.requireRoom(inviteCode);
      if (room.status !== "lobby") throw new RoomError("This game is no longer accepting players.");
      if (room.is_private && input.accessCode?.trim().toUpperCase() !== room.invite_code) {
        throw new RoomError("Enter the correct invite code to join this private table.");
      }
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

  closeHostedRoom(inviteCode: string, hostPlayerId: string): boolean {
    const room = this.requireRoom(inviteCode);
    const hostId = cleanText(hostPlayerId, "", 100);
    if (!hostId || room.host_player_id !== hostId) return false;
    this.database.prepare("DELETE FROM rooms WHERE id = ?").run(room.id);
    return true;
  }

  leave(inviteCode: string, playerId: string): { left: boolean; finished?: boolean } {
    const room = this.requireRoom(inviteCode);
    const roomPlayerId = cleanText(playerId, "", 100);
    const players = this.playersFor(room.id);
    const playerIndex = players.findIndex((player) => player.id === roomPlayerId);
    if (playerIndex === -1) return { left: false };

    this.database.exec("BEGIN IMMEDIATE");
    try {
      let finished = false;
      if (room.status === "playing") {
        const storedGame = this.database.prepare("SELECT game_state FROM room_games WHERE room_id = ?").get(room.id) as unknown as { game_state: string } | undefined;
        if (!storedGame) throw new RoomError("Game state could not be found.");
        const match = JSON.parse(storedGame.game_state) as MatchState;
        finished = removePlayer(match, `player-${playerIndex + 1}`).finished;
        match.lastEvent = { id: eventId(), message: `${players[playerIndex].name} left the game${finished ? "; the game is over." : "."}`, playerId: roomPlayerId, type: "leave" };
        this.database.prepare("UPDATE room_games SET game_state = ?, last_activity_at = ?, inactivity_deadline = NULL, revision = revision + 1 WHERE room_id = ?").run(JSON.stringify(match), Date.now(), room.id);
        if (finished) this.database.prepare("UPDATE rooms SET status = 'finished' WHERE id = ?").run(room.id);
      }
      this.database.prepare("DELETE FROM room_players WHERE room_id = ? AND id = ?").run(room.id, roomPlayerId);
      this.database.exec("COMMIT");
      return { left: true, finished };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  removeRoom(inviteCode: string): boolean {
    const room = this.database.prepare("SELECT * FROM rooms WHERE invite_code = ?").get(inviteCode.trim().toUpperCase()) as unknown as RoomRow | undefined;
    if (!room) return false;
    this.database.prepare("DELETE FROM rooms WHERE id = ?").run(room.id);
    return true;
  }

  sweepInactiveTables(now = Date.now(), inactiveAfterMs = 3 * 60_000, warningMs = 30_000): { warnedInviteCodes: string[]; removedInviteCodes: string[] } {
    const removedInviteCodes: string[] = [];
    const warnedInviteCodes: string[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const expired = this.database.prepare("SELECT rooms.id, rooms.invite_code FROM rooms JOIN room_games ON room_games.room_id = rooms.id WHERE rooms.status = 'playing' AND room_games.inactivity_deadline IS NOT NULL AND room_games.inactivity_deadline <= ?")
        .all(now) as unknown as { id: string; invite_code: string }[];
      for (const room of expired) {
        this.database.prepare("DELETE FROM rooms WHERE id = ?").run(room.id);
        removedInviteCodes.push(room.invite_code);
      }

      const inactive = this.database.prepare("SELECT rooms.id, rooms.invite_code FROM rooms JOIN room_games ON room_games.room_id = rooms.id WHERE rooms.status = 'playing' AND room_games.inactivity_deadline IS NULL AND room_games.last_activity_at <= ?")
        .all(now - inactiveAfterMs) as unknown as { id: string; invite_code: string }[];
      for (const room of inactive) {
        this.database.prepare("UPDATE room_games SET inactivity_deadline = ?, revision = revision + 1 WHERE room_id = ?").run(now + warningMs, room.id);
        warnedInviteCodes.push(room.invite_code);
      }
      this.database.exec("COMMIT");
      return { warnedInviteCodes, removedInviteCodes };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  confirmTableActive(inviteCode: string, playerId: string, now = Date.now()): GameView {
    const room = this.requireRoom(inviteCode);
    if (room.host_player_id !== playerId) throw new RoomError("Only the host can keep this table open.");
    const game = this.database.prepare("SELECT inactivity_deadline FROM room_games WHERE room_id = ?").get(room.id) as unknown as { inactivity_deadline: number | null } | undefined;
    if (!game) throw new RoomError("Game state could not be found.");
    if (game.inactivity_deadline !== null && game.inactivity_deadline <= now) throw new RoomError("This table's inactivity timer has expired.");
    this.database.prepare("UPDATE room_games SET last_activity_at = ?, inactivity_deadline = NULL, revision = revision + 1 WHERE room_id = ?").run(now, room.id);
    return this.gameView(inviteCode, playerId);
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
    if (room.host_player_id !== playerId) throw new RoomError("Only the host can start this game.");
    if (players.length < 2) throw new RoomError("At least two players are needed to start.");

    const match = createMatch(players.map((player) => player.name));
    match.lastEvent = { id: eventId(), message: "Everyone: peek at two cards before the first turn begins.", playerId, type: "start" };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE rooms SET status = 'playing' WHERE id = ?").run(room.id);
      this.database.prepare("INSERT INTO room_games (room_id, game_state, last_activity_at, inactivity_deadline, revision) VALUES (?, ?, ?, NULL, 1) ON CONFLICT(room_id) DO UPDATE SET game_state = excluded.game_state, last_activity_at = excluded.last_activity_at, inactivity_deadline = NULL, revision = room_games.revision + 1")
        .run(room.id, JSON.stringify(match), Date.now());
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
      isPrivate: Boolean(room.is_private),
      players: players.map((player) => ({ id: player.id, name: player.name })),
    };
    const viewerIndex = players.findIndex((player) => player.id === playerId);
    if (viewerIndex === -1) throw new RoomError("Enter this table before viewing it.");
    const canStart = room.status === "lobby" && room.host_player_id === playerId;
    const storedGame = this.database.prepare("SELECT game_state, inactivity_deadline, revision FROM room_games WHERE room_id = ?").get(room.id) as unknown as { game_state: string; inactivity_deadline: number | null; revision: number } | undefined;
    if (!storedGame) return { room: roomView, canStart };

    const match = JSON.parse(storedGame.game_state) as MatchState;
    const revealed = match.hole.status === "scored" || match.status === "finished";
    const viewerEngineId = viewerIndex === -1 ? undefined : `player-${viewerIndex + 1}`;
    const currentEnginePlayer = match.players[match.hole.currentPlayerIndex];
    const currentIndex = currentEnginePlayer ? match.players.findIndex((player) => player.id === currentEnginePlayer.id) : -1;
    const currentRoomPlayer = players[currentIndex];
    const activeEnginePlayers = match.players.filter((player) => !match.eliminatedPlayerIds?.includes(player.id));
    const isPeeking = match.status === "playing" && match.hole.status === "playing" && activeEnginePlayers.some((player) => !match.hole.peekedPlayerIds.includes(player.id));
    const pendingMatchGift = match.hole.pendingMatchGift;
    const viewerCanAct = match.status === "playing" && !isPeeking && match.hole.status === "playing" && !match.hole.finalMatchDeadline && !pendingMatchGift && currentEnginePlayer?.id === viewerEngineId;
    const pendingPower = match.hole.pendingPower;
    const swapIsSettling = pendingPower?.rank === "8" && pendingPower.used === true;
    const pendingPowerIndex = pendingPower ? match.players.findIndex((player) => player.id === pendingPower.playerId) : -1;
    const viewPlayers = players.map((player, index) => {
      const enginePlayerId = `player-${index + 1}`;
      const layout = match.hole.layouts[enginePlayerId] ?? [];
      return {
        id: player.id,
        name: player.name,
        isYou: player.id === playerId,
        isOut: match.eliminatedPlayerIds?.includes(enginePlayerId) ?? false,
        cardCount: layout.filter(Boolean).length,
        cards: layout.map((card) => (revealed && card ? publicCard(card) : null)),
        occupiedSlots: layout.map(Boolean),
        disconnectDeadline: disconnectDeadline(room.invite_code, player.id),
        totalScore: match.players[index]?.totalScore || 0,
        score: revealed ? match.hole.scores?.[enginePlayerId] : undefined,
      };
    });

    const phase = match.status === "finished" ? "finished" : match.hole.status;
    const discard = match.hole.discard.at(-1);
    const finalMatching = Boolean(match.hole.finalMatchDeadline);
    return {
      room: roomView,
      canStart,
      game: {
        revision: storedGame.revision,
        holeNumber: match.hole.number,
        holesToPlay: match.holesToPlay,
        phase,
        holeWinnerName: match.hole.winnerId ? match.players.find((player) => player.id === match.hole.winnerId)?.name : undefined,
        tieBreakRounds: match.hole.tieBreakRounds?.length || 0,
        tieBreaks: match.hole.tieBreakRounds?.map((round) => round.map(({ playerId: tieBreakPlayerId, card }) => ({
          playerName: match.players.find((player) => player.id === tieBreakPlayerId)?.name || "A player",
          card: publicCard(card),
        }))),
        currentPlayerId: finalMatching ? undefined : currentRoomPlayer?.id,
        currentPlayerName: finalMatching ? undefined : currentRoomPlayer?.name,
        stockCount: match.hole.stock.length,
        discard: discard ? publicCard(discard) : null,
        heldCard: viewerCanAct && match.hole.heldCard ? publicCard(match.hole.heldCard.card) : undefined,
        isPeeking,
        peekedPlayers: match.hole.peekedPlayerIds.filter((id) => activeEnginePlayers.some((player) => player.id === id)).length,
        activePlayerCount: activeEnginePlayers.length,
        heldCardSource: viewerCanAct ? match.hole.heldCard?.source : undefined,
        canPeek: match.status === "playing" && match.hole.status === "playing" && viewerEngineId && !match.eliminatedPlayerIds?.includes(viewerEngineId) ? !match.hole.peekedPlayerIds.includes(viewerEngineId) : false,
        canAct: viewerCanAct,
        pendingPower: pendingPower && pendingPowerIndex >= 0 ? {
          rank: pendingPower.rank,
          playerId: players[pendingPowerIndex]?.id || "",
          playerName: match.players[pendingPowerIndex]?.name || "A player",
        } : undefined,
        // A used J/Q waits for its owner to confirm the private reveal. A used
        // eight is completed by the server after its one-second display pause.
        canUsePower: Boolean(pendingPower?.playerId === viewerEngineId && pendingPower?.used !== true),
        canCompletePower: Boolean(pendingPower?.playerId === viewerEngineId && !swapIsSettling),
        // The discard remains a valid match target while somebody is holding
        // a stock card or resolving a power. A pending gift is deliberately
        // exclusive because it has an empty card slot to fill first.
        canMatch: Boolean(discard) && match.status === "playing" && !isPeeking && match.hole.status === "playing" && !pendingMatchGift && !swapIsSettling && Boolean(viewerEngineId && !match.eliminatedPlayerIds?.includes(viewerEngineId) && match.hole.layouts[viewerEngineId]?.some(Boolean)),
        pendingMatchGift: pendingMatchGift ? {
          playerId: players[match.players.findIndex((player) => player.id === pendingMatchGift.playerId)]?.id || "",
          playerName: match.players.find((player) => player.id === pendingMatchGift.playerId)?.name || "A player",
          targetPlayerId: players[match.players.findIndex((player) => player.id === pendingMatchGift.targetPlayerId)]?.id || "",
          targetPlayerName: match.players.find((player) => player.id === pendingMatchGift.targetPlayerId)?.name || "another player",
        } : undefined,
        canGiveMatchCard: pendingMatchGift?.playerId === viewerEngineId,
        knockerName: match.hole.knockerId ? match.players.find((player) => player.id === match.hole.knockerId)?.name : undefined,
        finalMatchDeadline: match.hole.finalMatchDeadline,
        inactivityDeadline: room.host_player_id === playerId ? storedGame.inactivity_deadline ?? undefined : undefined,
        lastEvent: match.lastEvent,
        players: viewPlayers,
      },
    };
  }

  previewMatchAttempt(inviteCode: string, roomPlayerId: string, action: MatchAction): MatchAttemptSnapshot & { playerName: string; targetPlayerId: string } {
    const room = this.requireRoom(inviteCode);
    if (room.status !== "playing") throw new RoomError("This game has not started.");
    const players = this.playersFor(room.id);
    const playerIndex = players.findIndex((player) => player.id === roomPlayerId);
    if (playerIndex === -1) throw new RoomError("Join this game before taking an action.");
    const storedGame = this.database.prepare("SELECT game_state FROM room_games WHERE room_id = ?").get(room.id) as unknown as { game_state: string } | undefined;
    if (!storedGame) throw new RoomError("Game state could not be found.");
    const match = JSON.parse(storedGame.game_state) as MatchState;
    const enginePlayerId = `player-${playerIndex + 1}`;
    const targetPlayerId = action.type === "match-own" ? roomPlayerId : action.targetPlayerId;
    const targetIndex = players.findIndex((player) => player.id === targetPlayerId);
    if (targetIndex === -1) throw new RoomError("Choose a player who is still at this table.");
    const attempt = action.type === "match-own"
      ? previewOwnDiscardMatch(match, enginePlayerId, action.layoutIndex)
      : previewOpponentDiscardMatch(match, enginePlayerId, { playerId: `player-${targetIndex + 1}`, layoutIndex: action.layoutIndex });
    return { ...attempt, playerName: players[playerIndex]?.name || "A player", targetPlayerId };
  }

  isMatchAttemptCurrent(inviteCode: string, roomPlayerId: string, action: MatchAction, expected: MatchAttemptSnapshot): boolean {
    try {
      const current = this.previewMatchAttempt(inviteCode, roomPlayerId, action);
      return current.discardCardId === expected.discardCardId && current.targetCardId === expected.targetCardId;
    } catch {
      return false;
    }
  }

  act(inviteCode: string, roomPlayerId: string, action: Exclude<GameAction, { type: "start" } | { type: "confirm-table-active" }>): { view: GameView; privatePeek?: PublicCard[]; privatePowerPeek?: { playerId: string; layoutIndex: number; card: PublicCard }; privateSelfReveal?: (PublicCard | null)[] } {
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
    let privatePowerPeek: { playerId: string; layoutIndex: number; card: PublicCard } | undefined;
    let privateSelfReveal: (PublicCard | null)[] | undefined;
    let eventType: NonNullable<MatchEvent["type"]> = action.type === "use-swap-power" || action.type === "use-peek-power"
      ? "power-peek"
      : action.type === "claim-other-match" || action.type === "give-match-card"
        ? "match-other"
        : action.type;
    let eventMessage: string | undefined;
    let affectedCards: { playerId: string; layoutIndex: number }[] | undefined;
    const engineReference = (roomId: string, layoutIndex: number): LayoutCardReference => {
      const index = players.findIndex((player) => player.id === roomId);
      if (index === -1) throw new RoomError("Choose a player who is still at this table.");
      return { playerId: `player-${index + 1}`, layoutIndex };
    };

    switch (action.type) {
      case "peek": privatePeek = peekInitialCards(match, enginePlayerId).map(publicCard); break;
      case "draw-stock": drawFromStock(match, enginePlayerId); break;
      case "take-discard": takeDiscard(match, enginePlayerId); break;
      case "replace": replaceLayoutCard(match, enginePlayerId, action.layoutIndex); break;
      case "discard-drawn": discardDrawnStockCard(match, enginePlayerId); break;
      case "keep-drawn": keepDrawnCard(match, enginePlayerId); break;
      case "use-swap-power": {
        const first = action.first ? engineReference(action.first.playerId, action.first.layoutIndex) : undefined;
        const second = action.second ? engineReference(action.second.playerId, action.second.layoutIndex) : undefined;
        resolveSwapPower(match, enginePlayerId, first, second);
        eventType = "power-swap";
        const firstName = action.first ? players.find((player) => player.id === action.first?.playerId)?.name || "one player" : "";
        const secondName = action.second ? players.find((player) => player.id === action.second?.playerId)?.name || "another player" : "";
        eventMessage = first && second
          ? action.first?.playerId === action.second?.playerId
            ? `${players[playerIndex]?.name || "A player"} swapped two of ${firstName}'s cards with an 8.`
            : `${players[playerIndex]?.name || "A player"} swapped cards between ${firstName} and ${secondName} with an 8.`
          : `${players[playerIndex]?.name || "A player"} kept the table as it was.`;
        affectedCards = [action.first, action.second].filter((card): card is { playerId: string; layoutIndex: number } => Boolean(card));
        break;
      }
      case "use-peek-power": {
        const target = engineReference(action.targetPlayerId, action.layoutIndex);
        const card = resolvePeekPower(match, enginePlayerId, target);
        eventType = "power-peek";
        eventMessage = `${players[playerIndex]?.name || "A player"} used a ${match.hole.discard.at(-1)?.rank || "power"} to inspect a card.`;
        affectedCards = [{ playerId: action.targetPlayerId, layoutIndex: action.layoutIndex }];
        privatePowerPeek = { playerId: action.targetPlayerId, layoutIndex: action.layoutIndex, card: publicCard(card) };
        break;
      }
      case "skip-power":
        skipPower(match, enginePlayerId);
        eventType = "skip-power";
        eventMessage = `${players[playerIndex]?.name || "A player"} skipped the power card.`;
        break;
      case "match-own": {
        const result = matchDiscard(match, enginePlayerId, action.layoutIndex);
        eventType = "match-own";
        let elimination;
        if (!result.correct) {
          privateSelfReveal = match.hole.layouts[enginePlayerId].map((card) => card ? publicCard(card) : null);
          elimination = eliminatePlayer(match, enginePlayerId);
        }
        const winnerName = elimination?.winnerId ? match.players.find((player) => player.id === elimination.winnerId)?.name || "The remaining player" : "";
        eventMessage = result.correct ? `${players[playerIndex]?.name || "A player"} matched the discard and lost a card.` : elimination?.winnerId ? `${players[playerIndex]?.name || "A player"} called a wrong match. ${winnerName} wins the hole.` : `${players[playerIndex]?.name || "A player"} called a wrong match and is out of the game.`;
        affectedCards = [{ playerId: roomPlayerId, layoutIndex: action.layoutIndex }];
        break;
      }
      case "claim-other-match": {
        const result = claimOpponentMatch(match, enginePlayerId, engineReference(action.targetPlayerId, action.layoutIndex));
        eventType = "match-other";
        const targetName = players.find((player) => player.id === action.targetPlayerId)?.name || "another player";
        let elimination;
        if (!result.correct) {
          privateSelfReveal = match.hole.layouts[enginePlayerId].map((card) => card ? publicCard(card) : null);
          elimination = eliminatePlayer(match, enginePlayerId);
        }
        const winnerName = elimination?.winnerId ? match.players.find((player) => player.id === elimination.winnerId)?.name || "The remaining player" : "";
        eventMessage = result.correct ? `${players[playerIndex]?.name || "A player"} matched ${targetName}'s card and must now give one card.` : elimination?.winnerId ? `${players[playerIndex]?.name || "A player"} called ${targetName}'s card wrong. ${winnerName} wins the hole.` : `${players[playerIndex]?.name || "A player"} called ${targetName}'s card wrong and is out of the game.`;
        affectedCards = [{ playerId: action.targetPlayerId, layoutIndex: action.layoutIndex }];
        break;
      }
      case "give-match-card": {
        const pendingGift = match.hole.pendingMatchGift;
        if (!pendingGift) throw new RoomError("There is no matching-card gift waiting for you.");
        const targetIndex = match.players.findIndex((player) => player.id === pendingGift.targetPlayerId);
        giveMatchCard(match, enginePlayerId, action.layoutIndex);
        eventType = "match-other";
        eventMessage = `${players[playerIndex]?.name || "A player"} gave a card to ${players[targetIndex]?.name || "another player"}.`;
        affectedCards = [{ playerId: players[targetIndex]?.id || "", layoutIndex: pendingGift.targetLayoutIndex }, { playerId: roomPlayerId, layoutIndex: action.layoutIndex }];
        break;
      }
      case "knock": {
        const alreadyKnocked = Boolean(match.hole.knockerId);
        knock(match, enginePlayerId);
        if (alreadyKnocked) eventMessage = `${players[playerIndex]?.name || "A player"} passed their final turn.`;
        break;
      }
      case "finalize-knock": finalizeKnock(match); break;
      case "next-hole": startNextHole(match); break;
    }
    const playerName = players[playerIndex]?.name || "A player";
    const everyonePeeked = action.type === "peek" && match.hole.peekedPlayerIds.length === match.players.length;
    const holeWinner = match.hole.winnerId ? match.players.find((player) => player.id === match.hole.winnerId)?.name || "A player" : undefined;
    const completedHoleMessage = holeWinner ? `${holeWinner} wins the hole${match.hole.tieBreakRounds?.length ? ` after ${match.hole.tieBreakRounds.length} tie-break round${match.hole.tieBreakRounds.length === 1 ? "" : "s"}` : ""}.` : undefined;
    const message = everyonePeeked
      ? `Everyone has peeked. ${match.players[match.hole.currentPlayerIndex]?.name || "The next player"} starts.`
      : completedHoleMessage || eventMessage || actionMessage(playerName, action);
    match.lastEvent = { id: eventId(), message, playerId: roomPlayerId, type: eventType, layoutIndex: action.type === "replace" ? action.layoutIndex : undefined, affectedCards };
    this.saveMatch(room.id, match);
    return { view: this.gameView(inviteCode, roomPlayerId), privatePeek, privatePowerPeek, privateSelfReveal };
  }

  finishSwapPower(inviteCode: string, roomPlayerId: string): GameView {
    const room = this.requireRoom(inviteCode);
    if (room.status !== "playing") throw new RoomError("This game has not started.");
    const players = this.playersFor(room.id);
    const playerIndex = players.findIndex((player) => player.id === roomPlayerId);
    if (playerIndex === -1) throw new RoomError("Join this game before taking an action.");
    const storedGame = this.database.prepare("SELECT game_state FROM room_games WHERE room_id = ?").get(room.id) as unknown as { game_state: string } | undefined;
    if (!storedGame) throw new RoomError("Game state could not be found.");
    const match = JSON.parse(storedGame.game_state) as MatchState;
    completeSwapPower(match, `player-${playerIndex + 1}`);
    this.saveMatch(room.id, match);
    return this.gameView(inviteCode, roomPlayerId);
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        invite_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        host_player_id TEXT NOT NULL,
        player_limit INTEGER NOT NULL CHECK (player_limit BETWEEN 2 AND 12),
        is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
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
        game_state TEXT NOT NULL,
        last_activity_at INTEGER NOT NULL DEFAULT 0,
        inactivity_deadline INTEGER,
        revision INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS player_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK (channel IN ('lobby', 'room')),
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        body TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        CHECK ((channel = 'lobby' AND room_id IS NULL) OR (channel = 'room' AND room_id IS NOT NULL))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS chat_messages_by_channel ON chat_messages(channel, sent_at DESC);
      CREATE INDEX IF NOT EXISTS chat_messages_by_room ON chat_messages(room_id, sent_at DESC);
    `);
    const columns = this.database.prepare("PRAGMA table_info(rooms)").all() as unknown as { name: string }[];
    if (!columns.some((column) => column.name === "is_private")) {
      this.database.exec("ALTER TABLE rooms ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1));");
    }
    if (!columns.some((column) => column.name === "host_player_id")) {
      this.database.exec("ALTER TABLE rooms ADD COLUMN host_player_id TEXT NOT NULL DEFAULT '';\n        UPDATE rooms SET host_player_id = COALESCE((SELECT id FROM room_players WHERE room_id = rooms.id ORDER BY joined_at ASC LIMIT 1), '') WHERE host_player_id = ''; ");
    }
    const gameColumns = this.database.prepare("PRAGMA table_info(room_games)").all() as unknown as { name: string }[];
    if (!gameColumns.some((column) => column.name === "last_activity_at")) {
      this.database.exec("ALTER TABLE room_games ADD COLUMN last_activity_at INTEGER NOT NULL DEFAULT 0;");
    }
    if (!gameColumns.some((column) => column.name === "inactivity_deadline")) {
      this.database.exec("ALTER TABLE room_games ADD COLUMN inactivity_deadline INTEGER;");
    }
    if (!gameColumns.some((column) => column.name === "revision")) {
      this.database.exec("ALTER TABLE room_games ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;");
    }
    this.database.prepare("UPDATE room_games SET last_activity_at = ? WHERE last_activity_at = 0").run(Date.now());
    this.database.exec("INSERT OR IGNORE INTO player_profiles (id, name) SELECT id, name FROM room_players;");
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
      hostPlayerId: row.host_player_id,
      playerLimit: row.player_limit,
      isPrivate: Boolean(row.is_private),
      status: row.status,
      createdAt: row.created_at,
      players,
    };
  }

  private playersFor(roomId: string): RoomPlayer[] {
    const players = this.database.prepare("SELECT id, name, joined_at FROM room_players WHERE room_id = ? ORDER BY joined_at ASC").all(roomId) as unknown as PlayerRow[];
    return players.map((player): RoomPlayer => ({ id: player.id, name: player.name, joinedAt: player.joined_at }));
  }

  private requireRoomPlayer(roomId: string, playerId: string): RoomPlayer {
    const normalizedPlayerId = cleanText(playerId, "", 100);
    const player = this.database.prepare("SELECT id, name, joined_at FROM room_players WHERE room_id = ? AND id = ?").get(roomId, normalizedPlayerId) as unknown as PlayerRow | undefined;
    if (!player) throw new RoomError("Enter this table before using its chat.");
    return { id: player.id, name: player.name, joinedAt: player.joined_at };
  }

  private mapChatMessage(row: ChatMessageRow, inviteCode?: string): ChatMessage {
    return { id: row.id, channel: row.channel, inviteCode, playerId: row.player_id, playerName: row.player_name, body: row.body, sentAt: row.sent_at };
  }

  private trimChat(channel: "lobby" | "room", roomId?: string): void {
    if (channel === "lobby") {
      this.database.exec("DELETE FROM chat_messages WHERE channel = 'lobby' AND id NOT IN (SELECT id FROM chat_messages WHERE channel = 'lobby' ORDER BY sent_at DESC LIMIT 100)");
      return;
    }
    if (!roomId) return;
    this.database.prepare("DELETE FROM chat_messages WHERE channel = 'room' AND room_id = ? AND id NOT IN (SELECT id FROM chat_messages WHERE channel = 'room' AND room_id = ? ORDER BY sent_at DESC LIMIT 100)").run(roomId, roomId);
  }

  private saveMatch(roomId: string, match: MatchState): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE room_games SET game_state = ?, last_activity_at = ?, inactivity_deadline = NULL, revision = revision + 1 WHERE room_id = ?").run(JSON.stringify(match), Date.now(), roomId);
      if (match.status === "finished") this.database.prepare("UPDATE rooms SET status = 'finished' WHERE id = ?").run(roomId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }


  private nextInviteCode(requestedCode?: string): string {
    const requested = requestedCode?.trim().toUpperCase();
    if (requested) {
      if (!/^[A-Z0-9]{6}$/.test(requested)) throw new RoomError("Invite codes must contain six letters or numbers.");
      if (this.database.prepare("SELECT 1 FROM rooms WHERE invite_code = ?").get(requested)) throw new RoomError("That invite code is already in use. Try again.");
      return requested;
    }
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

function cleanChatBody(value: unknown): string {
  const body = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 280) : "";
  if (!body) throw new RoomError("Write a message before sending it.");
  return body;
}

function actionMessage(playerName: string, action: Exclude<GameAction, { type: "start" } | { type: "confirm-table-active" }>): string {
  switch (action.type) {
    case "peek": return `${playerName} peeked at two cards.`;
    case "draw-stock": return `${playerName} drew from the stock pile.`;
    case "take-discard": return `${playerName} took the discard card.`;
    case "replace": return `${playerName} replaced a card.`;
    case "discard-drawn": return `${playerName} discarded the drawn card.`;
    case "keep-drawn": return `${playerName} kept the drawn card.`;
    case "use-swap-power": return `${playerName} used an 8 power.`;
    case "use-peek-power": return `${playerName} inspected a card.`;
    case "skip-power": return `${playerName} skipped a power card.`;
    case "match-own": return `${playerName} called a matching card.`;
    case "claim-other-match": return `${playerName} called another player's card.`;
    case "give-match-card": return `${playerName} gave a matching-card gift.`;
    case "knock": return `${playerName} knocked — final turns begin.`;
    case "finalize-knock": return "The final matching window closed.";
    case "next-hole": return `${playerName} dealt the next hole.`;
  }
}

function eventId(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function publicCard(card: Card): PublicCard {
  return {
    rank: card.rank,
    suit: card.suit,
    jokerColor: card.rank === "JOKER" ? card.jokerColor ?? (card.id.includes("JOKER-red-") ? "red" : "black") : undefined,
  };
}

declare global {
  var fairwayFourRoomRegistry: SqliteRoomRegistry | undefined;
  var fairwayFourRoomRegistryVersion: number | undefined;
}

export function persistentRoomRegistry(): SqliteRoomRegistry {
  const registryVersion = 18;
  if (globalThis.fairwayFourRoomRegistryVersion !== registryVersion || !globalThis.fairwayFourRoomRegistry) {
    const oldRegistry = globalThis.fairwayFourRoomRegistry as { close?: unknown } | undefined;
    if (typeof oldRegistry?.close === "function") oldRegistry.close();
    globalThis.fairwayFourRoomRegistry = new SqliteRoomRegistry();
    globalThis.fairwayFourRoomRegistryVersion = registryVersion;
  }
  return globalThis.fairwayFourRoomRegistry;
}
