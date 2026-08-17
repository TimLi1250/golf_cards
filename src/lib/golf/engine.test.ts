import assert from "node:assert/strict";
import test from "node:test";
import {
  GolfRuleError,
  createMatch,
  currentPlayer,
  discardDrawnStockCard,
  drawFromStock,
  knock,
  peekInitialCards,
  replaceLayoutCard,
  scoreCard,
  scoreLayout,
  removePlayer,
  startNextHole,
  takeDiscard,
} from "./engine";

const players = ["Avery", "Blake", "Casey", "Devon"];
const deterministicRandom = () => 0.5;

function completeInitialPeeks(match: ReturnType<typeof createMatch>) {
  for (const player of match.players) peekInitialCards(match, player.id);
}

test("deals four unique cards to every player and begins left of dealer", () => {
  const match = createMatch(players, { random: deterministicRandom });
  const allCards = Object.values(match.hole.layouts).flat();
  assert.equal(allCards.length, 16);
  assert.equal(new Set(allCards.map((card) => card.id)).size, 16);
  assert.equal(currentPlayer(match).name, "Blake");
  assert.equal(match.hole.stock.length, 35);
  assert.equal(match.hole.discard.length, 1);
});

test("supports up to twelve players and adds a second deck after six players", () => {
  const twelvePlayerMatch = createMatch(
    Array.from({ length: 12 }, (_, index) => `Player ${index + 1}`),
    { random: deterministicRandom },
  );
  assert.equal(twelvePlayerMatch.hole.deckCount, 2);
  assert.equal(twelvePlayerMatch.hole.stock.length, 55);
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

test("knock gives every other player exactly one final normal turn then scores", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  knock(match, "player-2");
  assert.equal(currentPlayer(match).id, "player-3");
  for (const playerId of ["player-3", "player-4", "player-1"]) {
    drawFromStock(match, playerId);
    discardDrawnStockCard(match, playerId);
  }
  assert.equal(match.hole.status, "scored");
  assert.ok(match.hole.scores);
  assert.throws(() => drawFromStock(match, "player-2"), GolfRuleError);
});

test("scores cards and progresses to the next hole", () => {
  assert.equal(scoreCard({ id: "K-spades", rank: "K", suit: "spades" }), 0);
  assert.equal(scoreLayout([{ id: "A-clubs", rank: "A", suit: "clubs" }, { id: "Q-hearts", rank: "Q", suit: "hearts" }]), 11);
  const match = createMatch(players, { holesToPlay: 1, random: deterministicRandom });
  completeInitialPeeks(match);
  knock(match, "player-2");
  for (const playerId of ["player-3", "player-4", "player-1"]) {
    drawFromStock(match, playerId);
    discardDrawnStockCard(match, playerId);
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
