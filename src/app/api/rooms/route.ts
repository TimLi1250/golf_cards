import { NextRequest, NextResponse } from "next/server";
import { RoomError } from "../../../lib/rooms/registry";
import { persistentRoomRegistry } from "../../../lib/rooms/sqlite-registry";
import { publishLobbyUpdate } from "../../../lib/realtime/room-events";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ rooms: persistentRoomRegistry().list() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const room = persistentRoomRegistry().create({
      host: body.host,
      hostId: body.hostId,
      name: body.name,
      playerLimit: body.playerLimit,
      isPrivate: body.isPrivate,
      inviteCode: body.inviteCode,
    });
    publishLobbyUpdate();
    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    return roomErrorResponse(error);
  }
}

function roomErrorResponse(error: unknown) {
  const message = error instanceof RoomError ? error.message : "Unable to create a game right now.";
  return NextResponse.json({ error: message }, { status: 400 });
}
