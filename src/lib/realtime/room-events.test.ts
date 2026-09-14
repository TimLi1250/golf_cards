import assert from "node:assert/strict";
import test from "node:test";
import { publishGameEvent, roomEvents, type MatchResultEvent, type RealtimeGameEvent } from "./room-events";

test("publishes a typed realtime game event to the normalized room", async () => {
  const event: RealtimeGameEvent = {
    id: "swap-1",
    type: "swap:travel",
    occurredAt: 1_000,
    durationMs: 6_000,
    payload: {
      cards: [
        { playerId: "player-a", layoutIndex: 0 },
        { playerId: "player-b", layoutIndex: 1 },
      ],
      travelDurationMs: 900,
    },
  };
  const received = new Promise<{ inviteCode: string; event: RealtimeGameEvent }>((resolve) => {
    roomEvents.once("game:event", (inviteCode, publishedEvent) => resolve({ inviteCode, event: publishedEvent }));
  });

  publishGameEvent("abc123", event);

  assert.deepEqual(await received, { inviteCode: "ABC123", event });
});

test("publishes a cancelled terminal result for a lost match race", async () => {
  const event: MatchResultEvent = {
    id: "match-1",
    type: "match:result",
    occurredAt: 2_000,
    durationMs: 1_500,
    payload: { playerName: "Avery", outcome: "cancelled" },
  };
  const received = new Promise<RealtimeGameEvent>((resolve) => {
    roomEvents.once("game:event", (_inviteCode, publishedEvent) => resolve(publishedEvent));
  });

  publishGameEvent("abc123", event);

  assert.deepEqual(await received, event);
});
