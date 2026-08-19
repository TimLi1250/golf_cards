import { NextRequest, NextResponse } from "next/server";
import { RoomError } from "../../../../../lib/rooms/registry";
import { persistentRoomRegistry } from "../../../../../lib/rooms/sqlite-registry";
import { publishRoomChat } from "../../../../../lib/realtime/room-events";
import { canSendChat } from "../../../../../lib/chat-rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ inviteCode: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const playerId = request.nextUrl.searchParams.get("playerId") || "";
    return NextResponse.json({ messages: persistentRoomRegistry().roomChat(inviteCode, playerId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RoomError ? error.message : "Unable to load this chat." }, { status: 403 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const body = await request.json() as { playerId?: string; body?: string };
    if (!canSendChat(`room:${inviteCode.toUpperCase()}`, body.playerId || "")) return NextResponse.json({ error: "Please wait a moment before sending another message." }, { status: 429 });
    const message = persistentRoomRegistry().postRoomChat(inviteCode, { playerId: body.playerId || "", body: body.body || "" });
    publishRoomChat(inviteCode, message);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RoomError ? error.message : "Unable to send this message." }, { status: 400 });
  }
}
