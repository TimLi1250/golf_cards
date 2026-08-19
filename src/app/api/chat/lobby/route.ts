import { NextRequest, NextResponse } from "next/server";
import { RoomError } from "../../../../lib/rooms/registry";
import { persistentRoomRegistry } from "../../../../lib/rooms/sqlite-registry";
import { publishLobbyChat } from "../../../../lib/realtime/room-events";
import { canSendChat } from "../../../../lib/chat-rate-limit";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ messages: persistentRoomRegistry().lobbyChat() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { playerId?: string; playerName?: string; body?: string };
    if (!canSendChat("lobby", body.playerId || "")) return NextResponse.json({ error: "Please wait a moment before sending another message." }, { status: 429 });
    const message = persistentRoomRegistry().postLobbyChat({ playerId: body.playerId || "", playerName: body.playerName || "Guest", body: body.body || "" });
    publishLobbyChat(message);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RoomError ? error.message : "Unable to send this message." }, { status: 400 });
  }
}
