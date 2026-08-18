import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { publishLobbyUpdate, publishRoomUpdate, roomEvents } from "./src/lib/realtime/room-events";
import { clearDisconnectDeadline, roomDisconnectDeadlines, setDisconnectDeadline } from "./src/lib/realtime/disconnect-state";
import { persistentRoomRegistry } from "./src/lib/rooms/sqlite-registry";

async function bootstrap() {
  const development = process.env.NODE_ENV !== "production";
  const port = Number(process.env.PORT || 3000);
  const app = next({ dev: development, hostname: "0.0.0.0", port });
  const handler = app.getRequestHandler();

  await app.prepare();
  const httpServer = createServer(handler);
  const io = new Server(httpServer, { path: "/socket.io" });
  const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const disconnectKey = (inviteCode: string, playerId: string) => `${inviteCode}:${playerId}`;

  const cancelDisconnectRemoval = (inviteCode: string, playerId: string) => {
    const key = disconnectKey(inviteCode, playerId);
    const timer = disconnectTimers.get(key);
    if (timer) clearTimeout(timer);
    disconnectTimers.delete(key);
    clearDisconnectDeadline(inviteCode, playerId);
  };

  const scheduleDisconnectRemoval = (room: string, playerId: string, excludedSocketId?: string, force = false) => {
    const inviteCode = room.slice("room:".length);
    const stillConnected = [...io.sockets.sockets.values()].some((candidate) =>
      candidate.id !== excludedSocketId && candidate.rooms.has(room) && candidate.data.playerId === playerId,
    );
    if (stillConnected && !force) return;

    cancelDisconnectRemoval(inviteCode, playerId);
    const key = disconnectKey(inviteCode, playerId);
    setDisconnectDeadline(inviteCode, playerId, Date.now() + 30_000);
    disconnectTimers.set(key, setTimeout(() => {
      disconnectTimers.delete(key);
      clearDisconnectDeadline(inviteCode, playerId);
      const reconnected = [...io.sockets.sockets.values()].some((candidate) =>
        candidate.rooms.has(room) && candidate.data.playerId === playerId,
      );
      if (reconnected) return;
      try {
        const result = persistentRoomRegistry().leave(inviteCode, playerId);
        if (result.left) {
          publishRoomUpdate(inviteCode);
          publishLobbyUpdate();
        }
      } catch (error) {
        if (!(error instanceof Error && error.message === "No open table was found with that invite code.")) {
          console.error(`Unable to remove disconnected player from ${inviteCode}:`, error);
        }
      }
      broadcastPresence(io, room);
    }, 30_000));
  };

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
      const normalizedInviteCode = inviteCode.toUpperCase();
      const room = `room:${normalizedInviteCode}`;
      if (typeof socket.data.playerId === "string") cancelDisconnectRemoval(normalizedInviteCode, socket.data.playerId);
      socket.join(room);
      broadcastPresence(io, room);
      broadcastLobbyPresence(io);
    });
    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room.startsWith("room:") && typeof socket.data.playerId === "string") {
          scheduleDisconnectRemoval(room, socket.data.playerId, socket.id);
          broadcastPresence(io, room, socket.id);
        }
      }
      broadcastLobbyPresence(io, socket.id);
    });
  });

  roomEvents.on("lobby:update", () => io.to("lobby").emit("lobby:update"));
  roomEvents.on("room:update", (inviteCode: string) => io.to(`room:${inviteCode}`).emit("room:update"));
  roomEvents.on("presence:update", (inviteCode: string, playerIds: string[]) => io.to(`room:${inviteCode}`).emit("presence:update", playerIds));
  roomEvents.on("disconnect:begin", (inviteCode: string, playerId: string, departingSocketId?: string) => {
    const room = `room:${inviteCode}`;
    const newerConnectionExists = [...io.sockets.sockets.values()].some((candidate) =>
      candidate.rooms.has(room) && candidate.data.playerId === playerId && candidate.id !== departingSocketId,
    );
    if (newerConnectionExists) return;
    scheduleDisconnectRemoval(room, playerId, departingSocketId, true);
    broadcastPresence(io, room, departingSocketId);
  });

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
  const inviteCode = room.slice("room:".length);
  const disconnectDeadlines = roomDisconnectDeadlines(inviteCode);
  io.to(room).emit("presence:update", { playerIds: [...new Set(playerIds)], disconnectDeadlines });
}
