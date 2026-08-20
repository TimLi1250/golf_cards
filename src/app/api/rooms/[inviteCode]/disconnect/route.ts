import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Kept as a harmless compatibility endpoint for older installed web apps.
 * Live Socket.IO disconnects now handle departures, which avoids removing a
 * player merely because a mobile browser briefly backgrounded the page.
 */
export async function POST() {
  return NextResponse.json({ scheduled: false }, { status: 410 });
}
