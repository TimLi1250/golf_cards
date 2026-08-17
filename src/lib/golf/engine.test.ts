import assert from "node:assert/strict";
import test from "node:test";
import {
  GolfRuleError,
  createMatch,
  currentPlayer,
  discardDrawnStockCard,
  drawFromStock,
  knock,
  matchDiscard,
  peekInitialCards,
  resolvePeekPower,
  resolveSwapPower,
  replaceLayoutCard,
  scoreCard,
  scoreLayout,
  skipPower,
  removePlayer,
  startNextHole,
  takeDiscard,
} from "./engine";

const players = ["Avery", "Blake", "Casey", "Devon"];
const deterministicRandom = () => 0.5;

function completeInitialPeeks(match: ReturnType<typeof createMatch>) {
  for (const player of match.players) peekInitialCards(match, player.id);
}

function finishStockTurn(match: ReturnType<typeof createMatch>, playerId: string) {
  drawFromStock(match, playerId);
  discardDrawnStockCard(match, playerId);
  if (match.hole.pendingPower) skipPower(match, playerId);
}

test("deals four unique cards to every player and begins left of dealer", () => {
  const match = createMatch(players, { random: deterministicRandom });
  const allCards = Object.values(match.hole.layouts).flat();
  assert.equal(allCards.length, 16);
  assert.equal(new Set(allCards.map((card) => card.id)).size, 16);
  assert.equal(currentPlayer(match).name, "Blake");
  assert.equal(match.hole.stock.length, 37);
  assert.equal(match.hole.discard.length, 1);
});

test("supports up to twelve players and adds a second deck after six players", () => {
  const twelvePlayerMatch = createMatch(
    Array.from({ length: 12 }, (_, index) => `Player ${index + 1}`),
    { random: deterministicRandom },
  );
  assert.equal(twelvePlayerMatch.hole.deckCount, 2);
  assert.equal(twelvePlayerMatch.hole.stock.length, 59);
  assert.equal(new Set(Object.values(twelvePlayerMatch.hole.layouts).flat().map((card) => card.id)).size, 48);

  const sixPlayerMatch = createMatch(players.slice(0, 4).concat(["Emery", "Frankie"]), { random: deterministicRandom });
  assert.equal(sixPlayerMatch.hole.deckCount, 1);
  assert.throws(() => createMatch(Array.from({ length: 13 }, (_, index) => `Player ${index}`)), GolfRuleError);
});

test("initial peek is private-use-once and exposes the player-facing pair", () => {
  const match = createMatch(players, { random: deterministicRandom });
  const peeked = peekInitialCards(match, "player-1");
  assert.deepEqual(peeked, match.hole.layouts["player-1"].slice(2));
  assert.throws(() => peekInitialCards(match, "player-1"), GolfRuleError);
  assert.throws(() => drawFromStock(match, "player-2"), /Everyone must peek/);
  for (const playerId of ["player-2", "player-3", "player-4"]) peekInitialCards(match, playerId);
  assert.doesNotThrow(() => drawFromStock(match, "player-2"));
});

test("stock card may be discarded without replacing a layout card", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  const originalLayout = [...match.hole.layouts["player-2"]];
  const drawn = drawFromStock(match, "player-2");
  discardDrawnStockCard(match, "player-2");
  assert.deepEqual(match.hole.layouts["player-2"], originalLayout);
  assert.deepEqual(match.hole.discard.at(-1), drawn);
  assert.equal(currentPlayer(match).id, "player-3");
});

test("a discard draw must replace a card", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  takeDiscard(match, "player-2");
  assert.throws(() => discardDrawnStockCard(match, "player-2"), GolfRuleError);
  replaceLayoutCard(match, "player-2", 0);
  assert.equal(currentPlayer(match).id, "player-3");
});

test("an eight pauses the turn for an optional blind swap", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  const first = match.hole.layouts["player-1"][0];
  const second = match.hole.layouts["player-3"][1];
  match.hole.layouts["player-2"][0] = { id: "8-power", rank: "8", suit: "clubs" };
  match.hole.heldCard = { card: { id: "replacement", rank: "3", suit: "hearts" }, source: "stock" };
  replaceLayoutCard(match, "player-2", 0);
  assert.deepEqual(match.hole.pendingPower, { rank: "8", playerId: "player-2" });
  assert.equal(currentPlayer(match).id, "player-2");
  resolveSwapPower(match, "player-2", { playerId: "player-1", layoutIndex: 0 }, { playerId: "player-3", layoutIndex: 1 });
  assert.equal(match.hole.layouts["player-1"][0], second);
  assert.equal(match.hole.layouts["player-3"][1], first);
  assert.equal(currentPlayer(match).id, "player-3");
});

test("jacks and queens privately reveal permitted cards", () => {
  const jackMatch = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(jackMatch);
  jackMatch.hole.layouts["player-2"][0] = { id: "J-power", rank: "J", suit: "clubs" };
  jackMatch.hole.heldCard = { card: { id: "replacement", rank: "3", suit: "hearts" }, source: "stock" };
  replaceLayoutCard(jackMatch, "player-2", 0);
  const own = resolvePeekPower(jackMatch, "player-2", { playerId: "player-2", layoutIndex: 1 });
  assert.equal(own.id, jackMatch.hole.layouts["player-2"][1].id);
  assert.throws(() => resolvePeekPower(jackMatch, "player-2", { playerId: "player-1", layoutIndex: 0 }), GolfRuleError);

  const queenMatch = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(queenMatch);
  queenMatch.hole.layouts["player-2"][0] = { id: "Q-power", rank: "Q", suit: "clubs" };
  queenMatch.hole.heldCard = { card: { id: "replacement", rank: "3", suit: "hearts" }, source: "stock" };
  replaceLayoutCard(queenMatch, "player-2", 0);
  const opponent = resolvePeekPower(queenMatch, "player-2", { playerId: "player-1", layoutIndex: 0 });
  assert.equal(opponent.id, queenMatch.hole.layouts["player-1"][0].id);
});

test("matching the discard removes a matching card and a wrong call loses the game", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  match.hole.discard = [{ id: "5-discard", rank: "5", suit: "clubs" }];
  match.hole.layouts["player-1"][0] = { id: "5-own", rank: "5", suit: "hearts" };
  assert.equal(matchDiscard(match, "player-1", { playerId: "player-1", layoutIndex: 0 }).correct, true);
  assert.equal(match.hole.layouts["player-1"].length, 3);

  match.hole.discard = [{ id: "7-discard", rank: "7", suit: "clubs" }];
  match.hole.layouts["player-1"][0] = { id: "7-opponent", rank: "7", suit: "hearts" };
  const gift = match.hole.layouts["player-2"][0];
  assert.equal(matchDiscard(match, "player-2", { playerId: "player-1", layoutIndex: 0 }, { playerId: "player-2", layoutIndex: 0 }).correct, true);
  assert.equal(match.hole.layouts["player-2"].length, 3);
  assert.equal(match.hole.layouts["player-1"].at(-1)?.id, gift.id);

  match.hole.discard = [{ id: "9-discard", rank: "9", suit: "clubs" }];
  match.hole.layouts["player-1"][0] = { id: "wrong-target", rank: "6", suit: "hearts" };
  assert.equal(matchDiscard(match, "player-2", { playerId: "player-1", layoutIndex: 0 }, { playerId: "player-2", layoutIndex: 0 }).correct, false);
  assert.equal(match.status, "finished");
  assert.equal(match.lostPlayerId, "player-2");
  assert.equal(match.hole.layouts["player-1"][0].rank, "6");
});

test("knock gives every other player exactly one final normal turn then scores", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  knock(match, "player-2");
  assert.equal(currentPlayer(match).id, "player-3");
  for (const playerId of ["player-3", "player-4", "player-1"]) {
    finishStockTurn(match, playerId);
  }
  assert.equal(match.hole.status, "scored");
  assert.ok(match.hole.scores);
  assert.throws(() => drawFromStock(match, "player-2"), GolfRuleError);
});

test("scores cards and progresses to the next hole", () => {
  assert.equal(scoreCard({ id: "K-spades", rank: "K", suit: "spades" }), 13);
  assert.equal(scoreCard({ id: "JOKER-red", rank: "JOKER", suit: "joker" }), -2);
  assert.equal(scoreLayout([{ id: "A-clubs", rank: "A", suit: "clubs" }, { id: "Q-hearts", rank: "Q", suit: "hearts" }]), 13);
  const match = createMatch(players, { holesToPlay: 1, random: deterministicRandom });
  completeInitialPeeks(match);
  knock(match, "player-2");
  for (const playerId of ["player-3", "player-4", "player-1"]) {
    finishStockTurn(match, playerId);
  }
  startNextHole(match);
  assert.equal(match.status, "finished");
});

test("removes a departing player and hands their turn to the next player", () => {
  const match = createMatch(players, { random: deterministicRandom });
  const result = removePlayer(match, "player-2");
  assert.deepEqual(result, { remainingPlayers: 3, finished: false });
  assert.deepEqual(match.players.map((player) => [player.id, player.name]), [["player-1", "Avery"], ["player-2", "Casey"], ["player-3", "Devon"]]);
  assert.equal(currentPlayer(match).name, "Casey");
  assert.equal(Object.keys(match.hole.layouts).length, 3);
  assert.equal(match.hole.layouts["player-2"].length, 4);
});

test("ends a match when a departure leaves one player", () => {
  const match = createMatch(players.slice(0, 2), { random: deterministicRandom });
  const result = removePlayer(match, "player-1");
  assert.deepEqual(result, { remainingPlayers: 1, finished: true });
  assert.equal(match.status, "finished");
});
