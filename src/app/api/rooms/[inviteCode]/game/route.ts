import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { OUT_GIF_DURATION_MS, SAFE_GIF_DURATION_MS, matchTravelDuration, waitForMatchTravel } from "../../../../../lib/golf/match-race";
import type { GameAction, MatchAction } from "../../../../../lib/golf/protocol";
import { RoomError } from "../../../../../lib/rooms/registry";
import { persistentRoomRegistry } from "../../../../../lib/rooms/sqlite-registry";
import { publishGameEvent, publishLobbyUpdate, publishRoomUpdate } from "../../../../../lib/realtime/room-events";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ inviteCode: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const playerId = request.nextUrl.searchParams.get("playerId") || "";
    return NextResponse.json({ view: persistentRoomRegistry().gameView(inviteCode, playerId) });
  } catch (error) {
    if (error instanceof RoomError && error.message === "Enter this table before viewing it.") {
      return NextResponse.json({ needsEntry: true });
    }
    return gameErrorResponse(error, 404);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { inviteCode } = await context.params;
    const body = await request.json() as { playerId?: string; action?: GameAction };
    if (!body.playerId || !body.action?.type) throw new RoomError("A player and game action are required.");
    const registry = persistentRoomRegistry();
    let result;
    if (body.action.type === "start") {
      result = { view: registry.startGame(inviteCode, body.playerId) };
    } else if (body.action.type === "confirm-table-active") {
      result = { view: registry.confirmTableActive(inviteCode, body.playerId) };
    } else if (isMatchAction(body.action)) {
      const attempt = registry.previewMatchAttempt(inviteCode, body.playerId, body.action);
      const attemptId = randomUUID();
      const durationMs = matchTravelDuration(attempt.correct);
      publishGameEvent(inviteCode, {
        id: attemptId,
        type: "match:travel",
        occurredAt: Date.now(),
        durationMs,
        payload: {
          playerId: body.playerId,
          targetPlayerId: attempt.targetPlayerId,
          layoutIndex: body.action.layoutIndex,
        },
      });
      await waitForMatchTravel(durationMs);
      if (!registry.isMatchAttemptCurrent(inviteCode, body.playerId, body.action, attempt)) {
        return NextResponse.json({ view: registry.gameView(inviteCode, body.playerId), matchAttemptCancelled: true });
      }
      result = registry.act(inviteCode, body.playerId, body.action);
      publishGameEvent(inviteCode, {
        id: attemptId,
        type: "match:result",
        occurredAt: Date.now(),
        durationMs: attempt.correct ? SAFE_GIF_DURATION_MS : OUT_GIF_DURATION_MS,
        payload: {
          playerName: attempt.playerName,
          outcome: attempt.correct ? "safe" : "out",
        },
      });
    } else {
      result = registry.act(inviteCode, body.playerId, body.action);
      if (body.action.type === "use-swap-power" && body.action.first && body.action.second && result.view.game?.lastEvent?.id) {
        publishGameEvent(inviteCode, {
          id: result.view.game.lastEvent.id,
          type: "swap:travel",
          occurredAt: Date.now(),
          durationMs: 6_000,
          payload: { cards: [body.action.first, body.action.second], travelDurationMs: 900 },
        });
        publishRoomUpdate(inviteCode);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        result = { view: registry.finishSwapPower(inviteCode, body.playerId) };
      }
    }
    publishRoomUpdate(inviteCode);
    publishLobbyUpdate();
    return NextResponse.json(result);
  } catch (error) {
    return gameErrorResponse(error, 400);
  }
}

function isMatchAction(action: GameAction): action is MatchAction {
  return action.type === "match-own" || action.type === "claim-other-match";
}

function gameErrorResponse(error: unknown, status: number) {
  console.error("Game route failed:", error);
  const message = error instanceof RoomError || error instanceof Error ? error.message : "Unable to update this game right now.";
  return NextResponse.json({ error: message }, { status });
}
