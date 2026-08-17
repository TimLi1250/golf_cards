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
    const room = persistentRoomRegistry().join(inviteCode, { playerId: body.playerId, playerName: body.playerName, accessCode: body.accessCode });
    publishLobbyUpdate();
    publishRoomUpdate(inviteCode);
    return NextResponse.json({ room });
  } catch (error) {
    return roomErrorResponse(error, 400);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const playerId = request.nextUrl.searchParams.get("playerId") || "";
    const removed = persistentRoomRegistry().closeHostedRoom(inviteCode, playerId);
    if (removed) {
      publishLobbyUpdate();
      publishRoomUpdate(inviteCode);
    }
    return NextResponse.json({ removed });
  } catch (error) {
    return roomErrorResponse(error, 400);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const body = await request.json() as { playerId?: string };
    const result = persistentRoomRegistry().leave(inviteCode, body.playerId || "");
    if (result.left) {
      publishLobbyUpdate();
      publishRoomUpdate(inviteCode);
    }
    return NextResponse.json(result);
  } catch (error) {
    return roomErrorResponse(error, 400);
  }
}

function roomErrorResponse(error: unknown, status: number) {
  const message = error instanceof RoomError ? error.message : "Unable to find this game right now.";
  return NextResponse.json({ error: message }, { status });
}
