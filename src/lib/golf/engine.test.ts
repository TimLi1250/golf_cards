import assert from "node:assert/strict";
import test from "node:test";
import {
  GolfRuleError,
  claimOpponentMatch,
  createDeck,
  createMatch,
  currentPlayer,
  discardDrawnStockCard,
  keepDrawnCard,
  drawFromStock,
  eliminatePlayer,
  finalizeKnock,
  giveMatchCard,
  knock,
  matchDiscard,
  peekInitialCards,
  resolvePeekPower,
  resolveSwapPower,
  replaceLayoutCard,
  scoreCard,
  scoreHole,
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

function cardId(card: ReturnType<typeof createMatch>["hole"]["layouts"][string][number]) {
  return card?.id;
}

test("deals four unique cards to every player and begins left of dealer", () => {
  const match = createMatch(players, { random: deterministicRandom });
  const allCards = Object.values(match.hole.layouts).flat();
  assert.equal(allCards.length, 16);
  assert.equal(new Set(allCards.map((card) => card?.id)).size, 16);
  assert.equal(currentPlayer(match).name, "Blake");
  assert.equal(match.hole.stock.length, 38);
  assert.equal(match.hole.discard.length, 0);
});

test("creates one red and one black joker per deck", () => {
  const jokers = createDeck().filter((card) => card.rank === "JOKER");
  assert.deepEqual(jokers.map((card) => card.jokerColor), ["red", "black"]);
});

test("supports up to twelve players and adds a second deck after six players", () => {
  const twelvePlayerMatch = createMatch(
    Array.from({ length: 12 }, (_, index) => `Player ${index + 1}`),
    { random: deterministicRandom },
  );
  assert.equal(twelvePlayerMatch.hole.deckCount, 2);
  assert.equal(twelvePlayerMatch.hole.stock.length, 60);
  assert.equal(new Set(Object.values(twelvePlayerMatch.hole.layouts).flat().map((card) => card?.id)).size, 48);

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

test("a player with no cards can keep a drawn stock card", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  match.hole.layouts["player-2"] = [null, null, null, null];
  const drawn = drawFromStock(match, "player-2");
  keepDrawnCard(match, "player-2");
  assert.equal(match.hole.layouts["player-2"][0]?.id, drawn.id);
  assert.equal(currentPlayer(match).id, "player-3");
});

test("a discard draw must replace a card", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  match.hole.discard.push(match.hole.stock.pop()!);
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
  assert.equal(own.id, jackMatch.hole.layouts["player-2"][1]?.id);
  assert.throws(() => resolvePeekPower(jackMatch, "player-2", { playerId: "player-1", layoutIndex: 0 }), GolfRuleError);

  const queenMatch = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(queenMatch);
  queenMatch.hole.layouts["player-2"][0] = { id: "Q-power", rank: "Q", suit: "clubs" };
  queenMatch.hole.heldCard = { card: { id: "replacement", rank: "3", suit: "hearts" }, source: "stock" };
  replaceLayoutCard(queenMatch, "player-2", 0);
  const opponent = resolvePeekPower(queenMatch, "player-2", { playerId: "player-1", layoutIndex: 0 });
  assert.equal(opponent.id, queenMatch.hole.layouts["player-1"][0]?.id);
});

test("matching the discard removes a matching card and reports a wrong call for elimination", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  match.hole.discard = [{ id: "5-discard", rank: "5", suit: "clubs" }];
  match.hole.layouts["player-1"][0] = { id: "5-own", rank: "5", suit: "hearts" };
  assert.equal(matchDiscard(match, "player-1", 0).correct, true);
  assert.equal(match.hole.layouts["player-1"].length, 4);
  assert.equal(match.hole.layouts["player-1"][0], null);

  match.hole.discard = [{ id: "7-discard", rank: "7", suit: "clubs" }];
  match.hole.layouts["player-1"][0] = { id: "7-opponent", rank: "7", suit: "hearts" };
  const opponentCardCount = match.hole.layouts["player-1"].length;
  const giftId = match.hole.layouts["player-2"][0]?.id;
  assert.equal(claimOpponentMatch(match, "player-2", { playerId: "player-1", layoutIndex: 0 }).correct, true);
  assert.equal(match.hole.layouts["player-1"].length, opponentCardCount);
  assert.equal(match.hole.layouts["player-1"][0], null);
  giveMatchCard(match, "player-2", 0);
  assert.equal(match.hole.layouts["player-2"].length, 4);
  assert.equal(match.hole.layouts["player-2"][0], null);
  assert.equal(match.hole.layouts["player-1"].length, opponentCardCount);
  assert.equal(cardId(match.hole.layouts["player-1"][0]), giftId);

  match.hole.discard = [{ id: "9-discard", rank: "9", suit: "clubs" }];
  match.hole.layouts["player-1"][0] = { id: "wrong-target", rank: "6", suit: "hearts" };
  assert.equal(claimOpponentMatch(match, "player-2", { playerId: "player-1", layoutIndex: 0 }).correct, false);
  assert.equal(match.status, "playing");
  assert.equal(match.hole.layouts["player-1"][0]?.rank, "6");
});

test("a match remains legal while the current player is holding a stock card", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  match.hole.discard = [{ id: "5-discard", rank: "5", suit: "clubs" }];
  match.hole.layouts["player-1"][0] = { id: "5-match", rank: "5", suit: "hearts" };

  drawFromStock(match, "player-2");
  assert.equal(matchDiscard(match, "player-1", 0).correct, true);
  assert.equal(match.hole.layouts["player-1"][0], null);
  assert.ok(match.hole.heldCard, "the current player's stock card remains in hand");
});

test("matched power cards wait their turn and resolve in order", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  match.hole.layouts["player-2"][0] = { id: "8-original", rank: "8", suit: "clubs" };
  match.hole.layouts["player-1"][0] = { id: "8-match", rank: "8", suit: "hearts" };
  match.hole.heldCard = { card: { id: "replacement", rank: "3", suit: "hearts" }, source: "stock" };

  replaceLayoutCard(match, "player-2", 0);
  assert.equal(matchDiscard(match, "player-1", 0).correct, true);
  assert.deepEqual(match.hole.pendingPowerQueue, [{ rank: "8", playerId: "player-1", endsTurn: false }]);

  skipPower(match, "player-2");
  assert.deepEqual(match.hole.pendingPower, { rank: "8", playerId: "player-1", endsTurn: false });
  assert.equal(currentPlayer(match).id, "player-3", "the normal turn advances once before the matched power");

  resolveSwapPower(match, "player-1");
  assert.equal(match.hole.pendingPower, undefined);
  assert.equal(currentPlayer(match).id, "player-3", "resolving a matched power does not consume another normal turn");
});

test("a Jack found with a Jack can be matched for another private peek", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  match.hole.layouts["player-2"][0] = { id: "J-original", rank: "J", suit: "clubs" };
  match.hole.layouts["player-2"][1] = { id: "J-match", rank: "J", suit: "hearts" };
  match.hole.heldCard = { card: { id: "replacement", rank: "3", suit: "hearts" }, source: "stock" };

  replaceLayoutCard(match, "player-2", 0);
  assert.equal(resolvePeekPower(match, "player-2", { playerId: "player-2", layoutIndex: 1 }).rank, "J");
  assert.equal(matchDiscard(match, "player-2", 1).correct, true);
  skipPower(match, "player-2");

  assert.deepEqual(match.hole.pendingPower, { rank: "J", playerId: "player-2", endsTurn: false });
  assert.equal(resolvePeekPower(match, "player-2", { playerId: "player-2", layoutIndex: 2 }).id, match.hole.layouts["player-2"][2]?.id);
});

test("the last active player wins the hole and leaves all cards available for scoring", () => {
  const match = createMatch(players.slice(0, 3), { random: deterministicRandom });
  assert.equal(eliminatePlayer(match, "player-2").advanced, false);
  const result = eliminatePlayer(match, "player-3");
  assert.equal(result.winnerId, "player-1");
  assert.equal(result.advanced, false);
  assert.equal(match.status, "playing");
  assert.equal(match.hole.number, 1);
  assert.equal(match.hole.status, "scored");
  assert.equal(match.players[0].totalScore, 1);
  startNextHole(match);
  assert.equal(match.hole.number, 2);
  assert.deepEqual(match.eliminatedPlayerIds, undefined);
});

test("knock gives every other player one turn then opens a five-second matching window", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  knock(match, "player-2");
  assert.equal(currentPlayer(match).id, "player-3");
  for (const playerId of ["player-3", "player-4", "player-1"]) {
    finishStockTurn(match, playerId);
  }
  assert.equal(match.hole.status, "playing");
  assert.ok(match.hole.finalMatchDeadline);
  assert.throws(() => finalizeKnock(match, match.hole.finalMatchDeadline! - 1), /still open/);
  finalizeKnock(match, match.hole.finalMatchDeadline);
  assert.equal(match.hole.status, "scored");
  assert.throws(() => drawFromStock(match, "player-2"), GolfRuleError);
});

test("a knock during final turns passes without rebuilding the final-turn queue", () => {
  const match = createMatch(players, { random: deterministicRandom });
  completeInitialPeeks(match);
  knock(match, "player-2");
  assert.deepEqual(match.hole.finalTurnQueue, ["player-3", "player-4", "player-1"]);

  knock(match, "player-3");

  assert.equal(match.hole.knockerId, "player-2");
  assert.deepEqual(match.hole.finalTurnQueue, ["player-4", "player-1"]);
  assert.equal(currentPlayer(match).id, "player-4");
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
  finalizeKnock(match, match.hole.finalMatchDeadline);
  startNextHole(match);
  assert.equal(match.status, "finished");
});

test("awards one point to the lowest layout and breaks ties with the highest drawn card", () => {
  const match = createMatch(players.slice(0, 2), { random: deterministicRandom });
  match.hole.layouts["player-1"] = [
    { id: "low-a", rank: "A", suit: "clubs" }, { id: "low-2", rank: "2", suit: "clubs" }, { id: "low-3", rank: "3", suit: "clubs" }, { id: "low-4", rank: "4", suit: "clubs" },
  ];
  match.hole.layouts["player-2"] = [
    { id: "high-k", rank: "K", suit: "clubs" }, { id: "high-q", rank: "Q", suit: "clubs" }, { id: "high-j", rank: "J", suit: "clubs" }, { id: "high-10", rank: "10", suit: "clubs" },
  ];
  assert.deepEqual(scoreHole(match), { "player-1": 1, "player-2": 0 });
  assert.equal(match.players[0].totalScore, 1);

  const tiedMatch = createMatch(players.slice(0, 2), { random: deterministicRandom });
  const tiedLayout = [
    { id: "tie-a", rank: "A" as const, suit: "clubs" as const }, { id: "tie-2", rank: "2" as const, suit: "clubs" as const }, { id: "tie-3", rank: "3" as const, suit: "clubs" as const }, { id: "tie-4", rank: "4" as const, suit: "clubs" as const },
  ];
  tiedMatch.hole.layouts["player-1"] = tiedLayout;
  tiedMatch.hole.layouts["player-2"] = tiedLayout.map((card) => ({ ...card, id: `${card.id}-other` }));
  tiedMatch.hole.stock = [{ id: "tie-q", rank: "Q", suit: "hearts" }, { id: "tie-k", rank: "K", suit: "spades" }];
  assert.deepEqual(scoreHole(tiedMatch), { "player-1": 1, "player-2": 0 });
  assert.equal(tiedMatch.hole.winnerId, "player-1");
  assert.equal(tiedMatch.hole.tieBreakRounds?.length, 1);
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
