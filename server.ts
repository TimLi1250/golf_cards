import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { roomEvents } from "./src/lib/realtime/room-events";

async function bootstrap() {
  const development = process.env.NODE_ENV !== "production";
  const port = Number(process.env.PORT || 3000);
  const app = next({ dev: development, hostname: "0.0.0.0", port });
  const handler = app.getRequestHandler();

  await app.prepare();
  const httpServer = createServer(handler);
  const io = new Server(httpServer, { path: "/socket.io" });

  io.on("connection", (socket) => {
    socket.on("identify", (playerId: string) => { socket.data.playerId = playerId; });
    socket.on("watch:lobby", () => socket.join("lobby"));
    socket.on("watch:room", (inviteCode: string) => {
      const room = `room:${inviteCode.toUpperCase()}`;
      socket.join(room);
      broadcastPresence(io, room);
    });
    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room.startsWith("room:")) broadcastPresence(io, room, socket.id);
      }
    });
  });

  roomEvents.on("lobby:update", () => io.to("lobby").emit("lobby:update"));
  roomEvents.on("room:update", (inviteCode: string) => io.to(`room:${inviteCode}`).emit("room:update"));
  roomEvents.on("presence:update", (inviteCode: string, playerIds: string[]) => io.to(`room:${inviteCode}`).emit("presence:update", playerIds));

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
}

void bootstrap();

function broadcastPresence(io: Server, room: string, excludedSocketId?: string) {
  const playerIds = [...io.sockets.sockets.values()]
    .filter((socket) => socket.id !== excludedSocketId && socket.rooms.has(room) && typeof socket.data.playerId === "string")
    .map((socket) => socket.data.playerId as string);
  io.to(room).emit("presence:update", [...new Set(playerIds)]);
}
