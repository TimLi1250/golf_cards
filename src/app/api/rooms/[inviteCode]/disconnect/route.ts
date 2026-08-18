import { NextRequest, NextResponse } from "next/server";
import { RoomError } from "../../../../../lib/rooms/registry";
import { persistentRoomRegistry } from "../../../../../lib/rooms/sqlite-registry";
import { publishDisconnectRequest } from "../../../../../lib/realtime/room-events";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ inviteCode: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const body = await request.json() as { playerId?: string; socketId?: string };
    if (!body.playerId) throw new RoomError("A player session is required.");
    const room = persistentRoomRegistry().get(inviteCode);
    if (!room.players.some((player) => player.id === body.playerId)) {
      throw new RoomError("This player is not seated at the table.");
    }
    publishDisconnectRequest(inviteCode, body.playerId, body.socketId);
    return NextResponse.json({ scheduled: true }, { status: 202 });
  } catch (error) {
    const message = error instanceof RoomError || error instanceof Error ? error.message : "Unable to schedule disconnect removal.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
