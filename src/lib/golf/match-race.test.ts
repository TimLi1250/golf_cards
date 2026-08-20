import assert from "node:assert/strict";
import test from "node:test";
import {
  MATCH_TRAVEL_DURATION_MS,
  NON_MATCH_TRAVEL_DURATION_MS,
  matchTravelDuration,
} from "./match-race";

test("matching cards travel faster than non-matching cards", () => {
  assert.equal(matchTravelDuration(true), 250);
  assert.equal(matchTravelDuration(false), 650);
  assert.equal(NON_MATCH_TRAVEL_DURATION_MS - MATCH_TRAVEL_DURATION_MS, 400);
});
