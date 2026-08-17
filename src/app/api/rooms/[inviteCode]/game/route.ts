import { NextRequest, NextResponse } from "next/server";
import type { GameAction } from "../../../../../lib/golf/protocol";
import { RoomError } from "../../../../../lib/rooms/registry";
import { persistentRoomRegistry } from "../../../../../lib/rooms/sqlite-registry";
import { publishLobbyUpdate, publishRoomUpdate } from "../../../../../lib/realtime/room-events";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ inviteCode: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const playerId = request.nextUrl.searchParams.get("playerId") || "";
    return NextResponse.json({ view: persistentRoomRegistry().gameView(inviteCode, playerId) });
  } catch (error) {
    return gameErrorResponse(error, 404);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const body = await request.json() as { playerId?: string; action?: GameAction };
    if (!body.playerId || !body.action?.type) throw new RoomError("A player and game action are required.");
    const registry = persistentRoomRegistry();
    const result = body.action.type === "start"
      ? { view: registry.startGame(inviteCode, body.playerId) }
      : registry.act(inviteCode, body.playerId, body.action);
    publishRoomUpdate(inviteCode);
    publishLobbyUpdate();
    return NextResponse.json(result);
  } catch (error) {
    return gameErrorResponse(error, 400);
  }
}

function gameErrorResponse(error: unknown, status: number) {
  console.error("Game route failed:", error);
  const message = error instanceof RoomError || error instanceof Error ? error.message : "Unable to update this game right now.";
  return NextResponse.json({ error: message }, { status });
}
