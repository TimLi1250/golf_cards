export type Suit = "clubs" | "diamonds" | "hearts" | "spades" | "joker";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "JOKER";

export type Card = {
  id: string;
  rank: Rank;
  suit: Suit;
};

export type Player = {
  id: string;
  name: string;
  totalScore: number;
};

export type CardSource = "stock" | "discard";
export type PowerRank = "8" | "J" | "Q";

export type PendingPower = {
  rank: PowerRank;
  playerId: string;
};

export type LayoutCardReference = {
  playerId: string;
  layoutIndex: number;
};

export type HoleState = {
  number: number;
  dealerIndex: number;
  deckCount: number;
  layouts: Record<string, Card[]>;
  stock: Card[];
  discard: Card[];
  currentPlayerIndex: number;
  heldCard?: { card: Card; source: CardSource };
  pendingPower?: PendingPower;
  peekedPlayerIds: string[];
  knockerId?: string;
  finalTurnQueue?: string[];
  status: "playing" | "scored";
  scores?: Record<string, number>;
};

export type MatchState = {
  players: Player[];
  hole: HoleState;
  holesToPlay: number;
  status: "playing" | "finished";
  lostPlayerId?: string;
  lastEvent?: MatchEvent;
};

export type MatchEvent = {
  id: string;
  message: string;
  playerId?: string;
  type?: "start" | "peek" | "draw-stock" | "take-discard" | "replace" | "discard-drawn" | "knock" | "next-hole" | "leave" | "power-swap" | "power-peek" | "skip-power" | "match-own" | "match-other";
  layoutIndex?: number;
  affectedCards?: { playerId: string; layoutIndex: number }[];
};

const ranks: Exclude<Rank, "JOKER">[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits: Exclude<Suit, "joker">[] = ["clubs", "diamonds", "hearts", "spades"];

export class GolfRuleError extends Error {}

export function createDeck(deckCount = 1): Card[] {
  if (!Number.isInteger(deckCount) || deckCount < 1) {
    throw new GolfRuleError("At least one deck is required.");
  }
  return Array.from({ length: deckCount }, (_, deckIndex) => [
    ...suits.flatMap((suit) => ranks.map((rank) => ({ id: `${rank}-${suit}-${deckIndex + 1}`, rank, suit }))),
    { id: `JOKER-red-${deckIndex + 1}`, rank: "JOKER" as const, suit: "joker" as const },
    { id: `JOKER-black-${deckIndex + 1}`, rank: "JOKER" as const, suit: "joker" as const },
  ]).flat();
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function scoreCard(card: Card): number {
  if (card.rank === "JOKER") return -2;
  if (card.rank === "A") return 1;
  if (card.rank === "J") return 11;
  if (card.rank === "Q") return 12;
  if (card.rank === "K") return 13;
  return Number(card.rank);
}

export function scoreLayout(layout: Card[]): number {
  return layout.reduce((total, card) => total + scoreCard(card), 0);
}

export function createMatch(
  playerNames: string[],
  options: { holesToPlay?: number; random?: () => number } = {},
): MatchState {
  if (playerNames.length < 2 || playerNames.length > 12) {
    throw new GolfRuleError("Golf needs between two and twelve players.");
  }
  const players = playerNames.map((name, index) => ({
    id: `player-${index + 1}`,
    name: name.trim() || `Player ${index + 1}`,
    totalScore: 0,
  }));
  return {
    players,
    hole: dealHole(players, 1, 0, options.random),
    holesToPlay: options.holesToPlay ?? 9,
    status: "playing",
  };
}

export function dealHole(players: Player[], number: number, dealerIndex: number, random?: () => number): HoleState {
  const deckCount = players.length > 6 ? 2 : 1;
  const deck = shuffle(createDeck(deckCount), random);
  const layouts: Record<string, Card[]> = Object.fromEntries(players.map((player) => [player.id, []]));

  for (let cardNumber = 0; cardNumber < 4; cardNumber += 1) {
    for (const player of players) {
      const card = deck.pop();
      if (!card) throw new GolfRuleError("Deck ran out while dealing.");
      layouts[player.id].push(card);
    }
  }
  const firstDiscard = deck.pop();
  if (!firstDiscard) throw new GolfRuleError("Deck ran out while dealing.");

  return {
    number,
    dealerIndex,
    deckCount,
    layouts,
    stock: deck,
    discard: [firstDiscard],
    currentPlayerIndex: (dealerIndex + 1) % players.length,
    peekedPlayerIds: [],
    status: "playing",
  };
}

export function currentPlayer(match: MatchState): Player {
  return match.players[match.hole.currentPlayerIndex];
}

export function peekInitialCards(match: MatchState, playerId: string): Card[] {
  assertPlaying(match);
  const { hole } = match;
  assertPlayer(match, playerId);
  if (hole.peekedPlayerIds.includes(playerId)) {
    throw new GolfRuleError("This player has already used their initial peek.");
  }
  hole.peekedPlayerIds.push(playerId);
  // The bottom row is the player-facing, nearest pair in the table layout.
  return hole.layouts[playerId].slice(2, 4);
}

export function drawFromStock(match: MatchState, playerId: string): Card {
  assertCanDraw(match, playerId);
  const card = match.hole.stock.pop();
  if (!card) throw new GolfRuleError("The stock pile is empty.");
  match.hole.heldCard = { card, source: "stock" };
  return card;
}

export function takeDiscard(match: MatchState, playerId: string): Card {
  assertCanDraw(match, playerId);
  const card = match.hole.discard.pop();
  if (!card) throw new GolfRuleError("The discard pile is empty.");
  match.hole.heldCard = { card, source: "discard" };
  return card;
}

export function replaceLayoutCard(match: MatchState, playerId: string, layoutIndex: number): void {
  assertPlaying(match);
  assertTurn(match, playerId);
  const heldCard = match.hole.heldCard;
  if (!heldCard) throw new GolfRuleError("Draw a card before replacing a layout card.");
  if (!Number.isInteger(layoutIndex) || layoutIndex < 0 || layoutIndex > 3) {
    throw new GolfRuleError("Choose one of the four layout cards.");
  }
  const layout = match.hole.layouts[playerId];
  const replaced = layout[layoutIndex];
  layout[layoutIndex] = heldCard.card;
  match.hole.discard.push(replaced);
  match.hole.heldCard = undefined;
  resolveDiscardPowerOrEndTurn(match, playerId, replaced);
}

export function discardDrawnStockCard(match: MatchState, playerId: string): void {
  assertPlaying(match);
  assertTurn(match, playerId);
  const heldCard = match.hole.heldCard;
  if (!heldCard) throw new GolfRuleError("Draw a card before discarding it.");
  if (heldCard.source !== "stock") {
    throw new GolfRuleError("A card taken from the discard pile must replace a layout card.");
  }
  match.hole.discard.push(heldCard.card);
  match.hole.heldCard = undefined;
  resolveDiscardPowerOrEndTurn(match, playerId, heldCard.card);
}

/** Uses an eight that was just discarded to swap two unknown layout cards. */
export function resolveSwapPower(match: MatchState, playerId: string, first?: LayoutCardReference, second?: LayoutCardReference): void {
  assertPendingPower(match, playerId, "8");
  if ((first && !second) || (!first && second)) throw new GolfRuleError("Choose two cards to swap, or skip the eight.");
  if (first && second) {
    assertLayoutReference(match, first);
    assertLayoutReference(match, second);
    if (first.playerId === second.playerId && first.layoutIndex === second.layoutIndex) {
      throw new GolfRuleError("Choose two different cards to swap.");
    }
    const firstLayout = match.hole.layouts[first.playerId];
    const secondLayout = match.hole.layouts[second.playerId];
    [firstLayout[first.layoutIndex], secondLayout[second.layoutIndex]] = [secondLayout[second.layoutIndex], firstLayout[first.layoutIndex]];
  }
  match.hole.pendingPower = undefined;
  endTurn(match, playerId);
}

/** Uses a Jack or Queen to privately inspect an eligible layout card. */
export function resolvePeekPower(match: MatchState, playerId: string, target: LayoutCardReference): Card {
  const power = assertPendingPower(match, playerId);
  if (power.rank !== "J" && power.rank !== "Q") throw new GolfRuleError("The eight swaps cards instead of looking at them.");
  assertLayoutReference(match, target);
  if (power.rank === "J" && target.playerId !== playerId) {
    throw new GolfRuleError("A Jack can only look at one of your own cards.");
  }
  const card = match.hole.layouts[target.playerId][target.layoutIndex];
  match.hole.pendingPower = undefined;
  endTurn(match, playerId);
  return card;
}

/** Declines the optional action from a just-discarded power card. */
export function skipPower(match: MatchState, playerId: string): void {
  assertPendingPower(match, playerId);
  match.hole.pendingPower = undefined;
  endTurn(match, playerId);
}

/**
 * Plays a face-down layout card against the top discard without using a turn.
 * A correct call removes the matching card. A wrong call immediately ends the
 * match for the caller.
 */
export function matchDiscard(
  match: MatchState,
  playerId: string,
  target: LayoutCardReference,
  gift?: LayoutCardReference,
): { correct: boolean; discarded?: Card } {
  assertPlaying(match);
  assertInitialPeekComplete(match);
  assertPlayer(match, playerId);
  if (match.hole.heldCard || match.hole.pendingPower) throw new GolfRuleError("Finish the current play before calling a match.");
  assertLayoutReference(match, target);
  const targetIsOwn = target.playerId === playerId;
  if (!targetIsOwn) {
    if (!gift || gift.playerId !== playerId) throw new GolfRuleError("Choose one of your own cards to give the other player.");
    assertLayoutReference(match, gift);
  }

  const topDiscard = match.hole.discard.at(-1);
  if (!topDiscard) throw new GolfRuleError("The discard pile is empty.");
  const claimedCard = match.hole.layouts[target.playerId][target.layoutIndex];
  if (claimedCard.rank !== topDiscard.rank) {
    match.status = "finished";
    match.lostPlayerId = playerId;
    return { correct: false };
  }

  const matched = match.hole.layouts[target.playerId].splice(target.layoutIndex, 1)[0];
  if (!targetIsOwn) {
    const given = match.hole.layouts[playerId].splice(gift!.layoutIndex, 1)[0];
    match.hole.layouts[target.playerId].push(given);
  }
  match.hole.discard.push(matched);
  return { correct: true, discarded: matched };
}

export function knock(match: MatchState, playerId: string): void {
  assertPlaying(match);
  assertTurn(match, playerId);
  assertInitialPeekComplete(match);
  if (match.hole.heldCard) throw new GolfRuleError("Finish the current draw before knocking.");
  const finalTurnQueue = turnOrderAfter(match.players, match.hole.currentPlayerIndex);
  match.hole.knockerId = playerId;
  match.hole.finalTurnQueue = finalTurnQueue;
  match.hole.currentPlayerIndex = match.players.findIndex((player) => player.id === finalTurnQueue[0]);
}

export function scoreHole(match: MatchState): Record<string, number> {
  const scores = Object.fromEntries(
    match.players.map((player) => [player.id, scoreLayout(match.hole.layouts[player.id])]),
  );
  match.hole.scores = scores;
  match.hole.status = "scored";
  for (const player of match.players) player.totalScore += scores[player.id];
  return scores;
}

export function startNextHole(match: MatchState, random?: () => number): void {
  if (match.hole.status !== "scored") throw new GolfRuleError("Score the current hole first.");
  if (match.hole.number >= match.holesToPlay) {
    match.status = "finished";
    return;
  }
  match.hole = dealHole(
    match.players,
    match.hole.number + 1,
    (match.hole.dealerIndex + 1) % match.players.length,
    random,
  );
}

/** Removes a player from an active match while keeping the current hole valid. */
export function removePlayer(match: MatchState, playerId: string): { remainingPlayers: number; finished: boolean } {
  const leavingIndex = match.players.findIndex((player) => player.id === playerId);
  if (leavingIndex === -1) throw new GolfRuleError("Unknown player.");

  const { hole } = match;
  const currentPlayerId = match.players[hole.currentPlayerIndex]?.id;
  if (hole.heldCard && currentPlayerId === playerId) {
    hole.discard.push(hole.heldCard.card);
    hole.heldCard = undefined;
  }
  const clearedPendingPower = hole.pendingPower?.playerId === playerId;

  match.players.splice(leavingIndex, 1);
  delete hole.layouts[playerId];
  if (hole.scores) delete hole.scores[playerId];
  hole.peekedPlayerIds = hole.peekedPlayerIds.filter((id) => id !== playerId);
  if (hole.knockerId === playerId) hole.knockerId = undefined;
  if (clearedPendingPower) hole.pendingPower = undefined;
  if (hole.finalTurnQueue) hole.finalTurnQueue = hole.finalTurnQueue.filter((id) => id !== playerId);

  if (match.players.length < 2) {
    match.status = "finished";
    return { remainingPlayers: match.players.length, finished: true };
  }

  if (leavingIndex < hole.dealerIndex) hole.dealerIndex -= 1;
  else if (leavingIndex === hole.dealerIndex) hole.dealerIndex %= match.players.length;

  const idMap = new Map<string, string>();
  match.players = match.players.map((player, index) => {
    const nextId = `player-${index + 1}`;
    idMap.set(player.id, nextId);
    return { ...player, id: nextId };
  });
  hole.layouts = Object.fromEntries(Object.entries(hole.layouts).map(([id, layout]) => [idMap.get(id) ?? id, layout]));
  hole.peekedPlayerIds = hole.peekedPlayerIds.map((id) => idMap.get(id) ?? id);
  if (hole.knockerId) hole.knockerId = idMap.get(hole.knockerId);
  if (hole.pendingPower) hole.pendingPower.playerId = idMap.get(hole.pendingPower.playerId) ?? hole.pendingPower.playerId;
  if (hole.finalTurnQueue) hole.finalTurnQueue = hole.finalTurnQueue.map((id) => idMap.get(id) ?? id);
  if (hole.scores) hole.scores = Object.fromEntries(Object.entries(hole.scores).map(([id, score]) => [idMap.get(id) ?? id, score]));

  if (hole.status === "playing") {
    if (hole.finalTurnQueue) {
      if (hole.finalTurnQueue.length === 0) {
        scoreHole(match);
      } else {
        hole.currentPlayerIndex = match.players.findIndex((player) => player.id === hole.finalTurnQueue?.[0]);
      }
    } else if (leavingIndex < hole.currentPlayerIndex) {
      hole.currentPlayerIndex -= 1;
    } else if (leavingIndex === hole.currentPlayerIndex) {
      hole.currentPlayerIndex %= match.players.length;
    }
  }

  return { remainingPlayers: match.players.length, finished: match.status === "finished" };
}

function endTurn(match: MatchState, playerId: string): void {
  const { hole, players } = match;
  if (hole.finalTurnQueue) {
    if (hole.finalTurnQueue[0] !== playerId) throw new GolfRuleError("Unexpected final turn player.");
    hole.finalTurnQueue.shift();
    if (hole.finalTurnQueue.length === 0) {
      scoreHole(match);
      return;
    }
    hole.currentPlayerIndex = players.findIndex((player) => player.id === hole.finalTurnQueue?.[0]);
    return;
  }
  hole.currentPlayerIndex = (hole.currentPlayerIndex + 1) % players.length;
}

function turnOrderAfter(players: Player[], index: number): string[] {
  return Array.from({ length: players.length - 1 }, (_, offset) => players[(index + offset + 1) % players.length].id);
}

function assertPlaying(match: MatchState): void {
  if (match.status !== "playing" || match.hole.status !== "playing") {
    throw new GolfRuleError("This hole is no longer in play.");
  }
}

function assertPlayer(match: MatchState, playerId: string): void {
  if (!match.players.some((player) => player.id === playerId)) throw new GolfRuleError("Unknown player.");
}

function assertTurn(match: MatchState, playerId: string): void {
  assertPlayer(match, playerId);
  if (currentPlayer(match).id !== playerId) throw new GolfRuleError("It is not this player's turn.");
}

function assertCanDraw(match: MatchState, playerId: string): void {
  assertPlaying(match);
  assertTurn(match, playerId);
  assertInitialPeekComplete(match);
  if (match.hole.heldCard) throw new GolfRuleError("Resolve the drawn card before drawing again.");
  if (match.hole.pendingPower) throw new GolfRuleError("Use or skip the power card before drawing again.");
}

function assertInitialPeekComplete(match: MatchState): void {
  if (match.hole.peekedPlayerIds.length < match.players.length) {
    throw new GolfRuleError("Everyone must peek at their cards before the first turn begins.");
  }
}

function resolveDiscardPowerOrEndTurn(match: MatchState, playerId: string, discarded: Card): void {
  if (isPowerCard(discarded)) {
    match.hole.pendingPower = { rank: discarded.rank, playerId };
    return;
  }
  endTurn(match, playerId);
}

function isPowerCard(card: Card): card is Card & { rank: PowerRank } {
  return card.rank === "8" || card.rank === "J" || card.rank === "Q";
}

function assertPendingPower(match: MatchState, playerId: string, expectedRank?: PowerRank): PendingPower {
  assertPlaying(match);
  assertTurn(match, playerId);
  const power = match.hole.pendingPower;
  if (!power || power.playerId !== playerId) throw new GolfRuleError("There is no power card waiting for you.");
  if (expectedRank && power.rank !== expectedRank) throw new GolfRuleError(`The ${power.rank} power must be resolved instead.`);
  return power;
}

function assertLayoutReference(match: MatchState, reference: LayoutCardReference): void {
  assertPlayer(match, reference.playerId);
  const layout = match.hole.layouts[reference.playerId];
  if (!Number.isInteger(reference.layoutIndex) || reference.layoutIndex < 0 || reference.layoutIndex >= layout.length) {
    throw new GolfRuleError("Choose a card that is still on the table.");
  }
}
