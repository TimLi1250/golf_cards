import { NextResponse } from "next/server";
import { persistentRoomRegistry } from "../../../lib/rooms/sqlite-registry";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const healthy = persistentRoomRegistry().healthCheck();
    return NextResponse.json({ status: healthy ? "ok" : "degraded" }, { status: healthy ? 200 : 503 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
