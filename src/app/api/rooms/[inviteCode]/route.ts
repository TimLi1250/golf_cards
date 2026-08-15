import { NextRequest, NextResponse } from "next/server";
import { RoomError } from "../../../../lib/rooms/registry";
import { persistentRoomRegistry } from "../../../../lib/rooms/sqlite-registry";
import { publishLobbyUpdate, publishRoomUpdate } from "../../../../lib/realtime/room-events";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ inviteCode: string }> };

export async function GET(_: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    return NextResponse.json({ room: persistentRoomRegistry().get(inviteCode) });
  } catch (error) {
    return roomErrorResponse(error, 404);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const body = await request.json();
    const room = persistentRoomRegistry().join(inviteCode, { playerId: body.playerId, playerName: body.playerName });
    publishLobbyUpdate();
    publishRoomUpdate(inviteCode);
    return NextResponse.json({ room });
  } catch (error) {
    return roomErrorResponse(error, 400);
  }
}

function roomErrorResponse(error: unknown, status: number) {
  const message = error instanceof RoomError ? error.message : "Unable to find this game right now.";
  return NextResponse.json({ error: message }, { status });
}
