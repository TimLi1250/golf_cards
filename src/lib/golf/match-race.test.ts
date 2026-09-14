import assert from "node:assert/strict";
import test from "node:test";
import {
  CANCELLED_MATCH_RESULT_DURATION_MS,
  MATCH_TRAVEL_DURATION_MS,
  NON_MATCH_TRAVEL_DURATION_MS,
  matchTravelDuration,
} from "./match-race";

test("matching cards travel faster than non-matching cards", () => {
  assert.equal(matchTravelDuration(true), 250);
  assert.equal(matchTravelDuration(false), 650);
  assert.equal(NON_MATCH_TRAVEL_DURATION_MS - MATCH_TRAVEL_DURATION_MS, 400);
  assert.equal(CANCELLED_MATCH_RESULT_DURATION_MS, 1_500);
});
