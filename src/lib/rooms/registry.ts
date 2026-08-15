import { randomBytes, randomUUID } from "node:crypto";

export type RoomPlayer = {
  id: string;
  name: string;
  joinedAt: string;
};

export type Room = {
  id: string;
  inviteCode: string;
  name: string;
  host: string;
  playerLimit: number;
  players: RoomPlayer[];
  status: "lobby" | "playing" | "finished";
  createdAt: string;
};

export type PublicRoom = Omit<Room, "players"> & { players: RoomPlayer[] };

export class RoomError extends Error {}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  create(input: { host: string; hostId: string; name?: string; playerLimit: number }): Room {
    const host = cleanText(input.host, "Guest player", 24);
    const hostId = cleanText(input.hostId, "", 100);
    const name = cleanText(input.name, "Friday Scramble", 30);
    if (!hostId) throw new RoomError("A player session is required to host a game.");
    if (!Number.isInteger(input.playerLimit) || input.playerLimit < 2 || input.playerLimit > 12) {
      throw new RoomError("Tables can have between two and twelve players.");
    }

    const room: Room = {
      id: randomUUID(),
      inviteCode: this.nextInviteCode(),
      name,
      host,
      playerLimit: input.playerLimit,
      players: [{ id: hostId, name: host, joinedAt: new Date().toISOString() }],
      status: "lobby",
      createdAt: new Date().toISOString(),
    };
    this.rooms.set(room.inviteCode, room);
    return room;
  }

  list(): PublicRoom[] {
    return [...this.rooms.values()]
      .filter((room) => room.status === "lobby")
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
      .map(copyRoom);
  }

  get(inviteCode: string): PublicRoom {
    return copyRoom(this.requireRoom(inviteCode));
  }

  join(inviteCode: string, input: { playerId: string; playerName: string }): PublicRoom {
    const room = this.requireRoom(inviteCode);
    if (room.status !== "lobby") throw new RoomError("This game is no longer accepting players.");
    const playerId = cleanText(input.playerId, "", 100);
    const playerName = cleanText(input.playerName, "Guest player", 24);
    if (!playerId) throw new RoomError("A player session is required to join a game.");

    const existingPlayer = room.players.find((player) => player.id === playerId);
    if (existingPlayer) {
      existingPlayer.name = playerName;
      return copyRoom(room);
    }
    if (room.players.length >= room.playerLimit) throw new RoomError("This table is already full.");
    room.players.push({ id: playerId, name: playerName, joinedAt: new Date().toISOString() });
    return copyRoom(room);
  }

  private requireRoom(inviteCode: string): Room {
    const room = this.rooms.get(inviteCode.trim().toUpperCase());
    if (!room) throw new RoomError("No open table was found with that invite code.");
    return room;
  }

  private nextInviteCode(): string {
    let code = "";
    do {
      code = randomBytes(6).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    } while (code.length < 6 || this.rooms.has(code));
    return code;
  }
}

function cleanText(value: string | undefined, fallback: string, maxLength: number): string {
  const cleaned = value?.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned || fallback;
}

function copyRoom(room: Room): PublicRoom {
  return { ...room, players: room.players.map((player) => ({ ...player })) };
}

export const roomRegistry = new RoomRegistry();
