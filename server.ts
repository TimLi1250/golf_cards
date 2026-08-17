import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { publishLobbyUpdate, publishRoomUpdate, roomEvents } from "./src/lib/realtime/room-events";
import { persistentRoomRegistry } from "./src/lib/rooms/sqlite-registry";

async function bootstrap() {
  const development = process.env.NODE_ENV !== "production";
  const port = Number(process.env.PORT || 3000);
  const app = next({ dev: development, hostname: "0.0.0.0", port });
  const handler = app.getRequestHandler();

  await app.prepare();
  const httpServer = createServer(handler);
  const io = new Server(httpServer, { path: "/socket.io" });

  io.on("connection", (socket) => {
    socket.on("identify", (identity: PlayerIdentity | string) => {
      const player = normalizePlayer(identity);
      socket.data.playerId = player.id;
      socket.data.playerName = player.name;
      persistentRoomRegistry().upsertPlayer(player.id, player.name);
      broadcastLobbyPresence(io);
    });
    socket.on("watch:lobby", () => {
      socket.join("lobby");
      broadcastLobbyPresence(io);
    });
    socket.on("watch:room", (inviteCode: string) => {
      const room = `room:${inviteCode.toUpperCase()}`;
      socket.join(room);
      broadcastPresence(io, room);
      broadcastLobbyPresence(io);
    });
    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room.startsWith("room:")) broadcastPresence(io, room, socket.id);
      }
      broadcastLobbyPresence(io, socket.id);
    });
  });

  roomEvents.on("lobby:update", () => io.to("lobby").emit("lobby:update"));
  roomEvents.on("room:update", (inviteCode: string) => io.to(`room:${inviteCode}`).emit("room:update"));
  roomEvents.on("presence:update", (inviteCode: string, playerIds: string[]) => io.to(`room:${inviteCode}`).emit("presence:update", playerIds));

  const emptyTableSweep = setInterval(() => {
    const registry = persistentRoomRegistry();
    const removedInviteCodes = registry.inviteCodes().filter((inviteCode) => !io.sockets.adapter.rooms.get(`room:${inviteCode}`)?.size)
      .filter((inviteCode) => registry.removeRoom(inviteCode));
    if (removedInviteCodes.length === 0) return;
    publishLobbyUpdate();
    for (const inviteCode of removedInviteCodes) publishRoomUpdate(inviteCode);
  }, 60_000);
  emptyTableSweep.unref();

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
}

void bootstrap();

type PlayerIdentity = {
  playerId: string;
  name?: string;
};

type LobbyPresence = {
  id: string;
  name: string;
  status: "clubhouse" | "game";
};

function normalizePlayer(identity: PlayerIdentity | string): { id: string; name: string } {
  const playerId = (typeof identity === "string" ? identity : identity?.playerId || "").trim().slice(0, 100);
  const name = (typeof identity === "string" ? "Guest" : identity?.name || "Guest").trim().replace(/\s+/g, " ").slice(0, 24) || "Guest";
  return { id: playerId, name };
}

function broadcastLobbyPresence(io: Server, excludedSocketId?: string) {
  const playersInOpenTables = persistentRoomRegistry().playersInOpenTables();
  const players = new Map<string, LobbyPresence>();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.id === excludedSocketId || typeof socket.data.playerId !== "string" || !socket.data.playerId) continue;
    const inGame = playersInOpenTables.has(socket.data.playerId);
    const current = players.get(socket.data.playerId);
    players.set(socket.data.playerId, {
      id: socket.data.playerId,
      name: typeof socket.data.playerName === "string" && socket.data.playerName ? socket.data.playerName : current?.name || "Guest",
      status: inGame || current?.status === "game" ? "game" : "clubhouse",
    });
  }
  io.to("lobby").emit("lobby:presence", [...players.values()].sort((first, second) => first.name.localeCompare(second.name)));
}

function broadcastPresence(io: Server, room: string, excludedSocketId?: string) {
  const playerIds = [...io.sockets.sockets.values()]
    .filter((socket) => socket.id !== excludedSocketId && socket.rooms.has(room) && typeof socket.data.playerId === "string")
    .map((socket) => socket.data.playerId as string);
  io.to(room).emit("presence:update", [...new Set(playerIds)]);
}
