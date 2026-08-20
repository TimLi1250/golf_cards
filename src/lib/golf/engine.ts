export type Suit = "clubs" | "diamonds" | "hearts" | "spades" | "joker";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "JOKER";

export type Card = {
  id: string;
  rank: Rank;
  suit: Suit;
  jokerColor?: "red" | "black";
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
  /** A power remains open briefly after use so its owner can call a matching card. */
  used?: boolean;
  /** Matched powers are resolved between normal turns, so they do not advance one. */
  endsTurn?: boolean;
};

export type PendingMatchGift = {
  playerId: string;
  targetPlayerId: string;
  targetLayoutIndex: number;
  matchedCard: Card;
};

export type LayoutCardReference = {
  playerId: string;
  layoutIndex: number;
};

export type MatchAttemptSnapshot = {
  correct: boolean;
  discardCardId: string;
  targetCardId: string;
};

export type HoleState = {
  number: number;
  dealerIndex: number;
  deckCount: number;
  layouts: Record<string, (Card | null)[]>;
  stock: Card[];
  discard: Card[];
  currentPlayerIndex: number;
  heldCard?: { card: Card; source: CardSource };
  pendingPower?: PendingPower;
  pendingPowerQueue?: PendingPower[];
  pendingMatchGift?: PendingMatchGift;
  peekedPlayerIds: string[];
  knockerId?: string;
  finalTurnQueue?: string[];
  finalMatchDeadline?: number;
  status: "playing" | "scored";
  scores?: Record<string, number>;
  winnerId?: string;
  tieBreakRounds?: { playerId: string; card: Card }[][];
};

export type MatchState = {
  players: Player[];
  hole: HoleState;
  holesToPlay: number;
  status: "playing" | "finished";
  eliminatedPlayerIds?: string[];
  lastEvent?: MatchEvent;
};

export type MatchEvent = {
  id: string;
  message: string;
  playerId?: string;
  type?: "start" | "peek" | "draw-stock" | "take-discard" | "replace" | "discard-drawn" | "keep-drawn" | "knock" | "finalize-knock" | "next-hole" | "leave" | "power-swap" | "power-peek" | "skip-power" | "match-own" | "match-other";
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
    { id: `JOKER-red-${deckIndex + 1}`, rank: "JOKER" as const, suit: "joker" as const, jokerColor: "red" as const },
    { id: `JOKER-black-${deckIndex + 1}`, rank: "JOKER" as const, suit: "joker" as const, jokerColor: "black" as const },
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

export function scoreLayout(layout: (Card | null)[]): number {
  return layout.reduce((total, card) => total + (card ? scoreCard(card) : 0), 0);
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
  const layouts: Record<string, (Card | null)[]> = Object.fromEntries(players.map((player) => [player.id, []]));

  for (let cardNumber = 0; cardNumber < 4; cardNumber += 1) {
    for (const player of players) {
      const card = deck.pop();
      if (!card) throw new GolfRuleError("Deck ran out while dealing.");
      layouts[player.id].push(card);
    }
  }
  return {
    number,
    dealerIndex,
    deckCount,
    layouts,
    stock: deck,
    discard: [],
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
  assertActivePlayer(match, playerId);
  if (hole.peekedPlayerIds.includes(playerId)) {
    throw new GolfRuleError("This player has already used their initial peek.");
  }
  hole.peekedPlayerIds.push(playerId);
  // The bottom row is the player-facing, nearest pair in the table layout.
  return hole.layouts[playerId].slice(2, 4).filter((card): card is Card => Boolean(card));
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
  if (!replaced) throw new GolfRuleError("Choose a card that is still on the table.");
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

/** Keeps a stock draw when the player has no layout cards left (for example, a Joker). */
export function keepDrawnCard(match: MatchState, playerId: string): void {
  assertPlaying(match);
  assertTurn(match, playerId);
  const heldCard = match.hole.heldCard;
  if (!heldCard || heldCard.source !== "stock") {
    throw new GolfRuleError("Draw a stock card before choosing whether to keep it.");
  }
  const layout = match.hole.layouts[playerId];
  if (layout.some(Boolean)) throw new GolfRuleError("You may only keep a draw when you have no cards left.");
  const emptyIndex = layout.findIndex((card) => !card);
  if (emptyIndex === -1) throw new GolfRuleError("There is no empty place for this card.");
  layout[emptyIndex] = heldCard.card;
  match.hole.heldCard = undefined;
  endTurn(match, playerId);
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
  completePower(match, playerId);
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
  if (!card) throw new GolfRuleError("Choose a card that is still on the table.");
  // Leave a private-reveal power open after the reveal. This lets a player
  // who just spotted a matching J/Q call it before continuing.
  match.hole.pendingPower!.used = true;
  return card;
}

/** Declines the optional action from a just-discarded power card. */
export function skipPower(match: MatchState, playerId: string): void {
  assertPendingPower(match, playerId, undefined, true);
  completePower(match, playerId);
}

/**
 * Plays a face-down layout card against the top discard without using a turn.
 * A correct call removes the matching card. The registry removes a player who
 * makes a wrong call, allowing the remaining players to continue.
 */
export function matchDiscard(match: MatchState, playerId: string, layoutIndex: number): { correct: boolean; discarded?: Card } {
  const attempt = previewOwnDiscardMatch(match, playerId, layoutIndex);
  if (!attempt.correct) return { correct: false };

  const matched = match.hole.layouts[playerId][layoutIndex];
  if (!matched) throw new GolfRuleError("Choose a card that is still on the table.");
  match.hole.layouts[playerId][layoutIndex] = null;
  match.hole.discard.push(matched);
  queueMatchedPower(match, playerId, matched);
  return { correct: true, discarded: matched };
}

/** Claims an opponent's matching card. A correct claim must be followed by a gift. */
export function claimOpponentMatch(match: MatchState, playerId: string, target: LayoutCardReference): { correct: boolean } {
  const attempt = previewOpponentDiscardMatch(match, playerId, target);
  if (!attempt.correct) return { correct: false };

  const matchedCard = match.hole.layouts[target.playerId][target.layoutIndex];
  if (!matchedCard) throw new GolfRuleError("Choose a card that is still on the table.");
  match.hole.layouts[target.playerId][target.layoutIndex] = null;
  match.hole.pendingMatchGift = { playerId, targetPlayerId: target.playerId, targetLayoutIndex: target.layoutIndex, matchedCard };
  return { correct: true };
}

/** Validates an own-card match without changing the table. */
export function previewOwnDiscardMatch(match: MatchState, playerId: string, layoutIndex: number): MatchAttemptSnapshot {
  return previewDiscardMatch(match, playerId, { playerId, layoutIndex });
}

/** Validates an opponent-card match without changing the table. */
export function previewOpponentDiscardMatch(match: MatchState, playerId: string, target: LayoutCardReference): MatchAttemptSnapshot {
  const attempt = previewDiscardMatch(match, playerId, target);
  if (target.playerId === playerId) throw new GolfRuleError("Choose another player's card for an opponent match.");
  if (isEliminated(match, target.playerId)) throw new GolfRuleError("That player is already out of this hole.");
  return attempt;
}

function previewDiscardMatch(match: MatchState, playerId: string, target: LayoutCardReference): MatchAttemptSnapshot {
  assertPlaying(match);
  assertInitialPeekComplete(match);
  assertActivePlayer(match, playerId);
  assertMatchingAvailable(match);
  assertLayoutReference(match, target);
  const topDiscard = match.hole.discard.at(-1);
  if (!topDiscard) throw new GolfRuleError("The discard pile is empty.");
  const claimedCard = match.hole.layouts[target.playerId][target.layoutIndex];
  if (!claimedCard) throw new GolfRuleError("Choose a card that is still on the table.");
  return {
    correct: claimedCard.rank === topDiscard.rank,
    discardCardId: topDiscard.id,
    targetCardId: claimedCard.id,
  };
}

/** Completes a correct opponent match by placing one of the caller's cards into the empty position. */
export function giveMatchCard(match: MatchState, playerId: string, layoutIndex: number): void {
  assertPlaying(match);
  assertActivePlayer(match, playerId);
  const pendingGift = match.hole.pendingMatchGift;
  if (!pendingGift || pendingGift.playerId !== playerId) throw new GolfRuleError("There is no matching-card gift waiting for you.");
  assertLayoutReference(match, { playerId, layoutIndex });
  const given = match.hole.layouts[playerId][layoutIndex];
  if (!given) throw new GolfRuleError("Choose a card that is still on the table.");
  match.hole.layouts[playerId][layoutIndex] = null;
  match.hole.layouts[pendingGift.targetPlayerId][pendingGift.targetLayoutIndex] = given;
  match.hole.discard.push(pendingGift.matchedCard);
  match.hole.pendingMatchGift = undefined;
  queueMatchedPower(match, playerId, pendingGift.matchedCard);
}

export function knock(match: MatchState, playerId: string): void {
  assertPlaying(match);
  assertTurn(match, playerId);
  assertInitialPeekComplete(match);
  if (match.hole.heldCard) throw new GolfRuleError("Finish the current draw before knocking.");
  if (match.hole.pendingMatchGift) throw new GolfRuleError("Finish the matching-card gift before knocking.");
  if (match.hole.knockerId) {
    endTurn(match, playerId);
    return;
  }
  const finalTurnQueue = turnOrderAfter(match.players, match.hole.currentPlayerIndex)
    .filter((candidateId) => !isEliminated(match, candidateId));
  match.hole.knockerId = playerId;
  match.hole.finalTurnQueue = finalTurnQueue;
  match.hole.currentPlayerIndex = match.players.findIndex((player) => player.id === finalTurnQueue[0]);
}

export function finalizeKnock(match: MatchState, now = Date.now()): void {
  assertPlaying(match);
  const deadline = match.hole.finalMatchDeadline;
  if (!deadline) throw new GolfRuleError("The final matching window has not started.");
  if (now < deadline) throw new GolfRuleError("The final matching window is still open.");
  if (match.hole.pendingMatchGift) throw new GolfRuleError("Finish the matching-card gift before scoring.");
  match.hole.finalMatchDeadline = undefined;
  scoreHole(match);
}

export function scoreHole(match: MatchState): Record<string, number> {
  const active = activePlayers(match);
  if (active.length === 0) throw new GolfRuleError("No active players remain to win this hole.");
  const layoutScores = Object.fromEntries(active.map((player) => [player.id, scoreLayout(match.hole.layouts[player.id])]));
  const lowestScore = Math.min(...Object.values(layoutScores));
  let tiedPlayers = active.filter((player) => layoutScores[player.id] === lowestScore);
  const tieBreakRounds: { playerId: string; card: Card }[][] = [];

  while (tiedPlayers.length > 1) {
    const round = tiedPlayers.map((player) => ({ playerId: player.id, card: drawTieBreakCard(match) }));
    tieBreakRounds.push(round);
    const highestCardScore = Math.max(...round.map(({ card }) => scoreCard(card)));
    tiedPlayers = tiedPlayers.filter((player) => round.some(({ playerId, card }) => playerId === player.id && scoreCard(card) === highestCardScore));
  }
  match.hole.tieBreakRounds = tieBreakRounds.length > 0 ? tieBreakRounds : undefined;
  return awardHoleWin(match, tiedPlayers[0].id);
}

export function startNextHole(match: MatchState, random?: () => number): void {
  if (match.hole.status !== "scored") throw new GolfRuleError("Score the current hole first.");
  if (match.hole.number >= match.holesToPlay) {
    match.status = "finished";
    return;
  }
  // Being out applies only to the current hole. Every seated player returns
  // for the next deal.
  match.eliminatedPlayerIds = undefined;
  match.hole = dealHole(
    match.players,
    match.hole.number + 1,
    (match.hole.dealerIndex + 1) % match.players.length,
    random,
  );
  match.hole.currentPlayerIndex = nextActivePlayerIndex(match, match.hole.dealerIndex);
}

/** Keeps an eliminated player visible at the table while removing them from play. */
export function eliminatePlayer(match: MatchState, playerId: string): { remainingActivePlayers: number; finished: boolean; winnerId?: string; advanced: boolean } {
  assertPlaying(match);
  assertActivePlayer(match, playerId);
  const { hole } = match;
  match.eliminatedPlayerIds = [...(match.eliminatedPlayerIds ?? []), playerId];
  if (hole.pendingPower?.playerId === playerId) {
    hole.pendingPower = undefined;
    activateQueuedPower(match);
  }
  hole.pendingPowerQueue = hole.pendingPowerQueue?.filter((power) => power.playerId !== playerId);
  if (hole.finalTurnQueue) hole.finalTurnQueue = hole.finalTurnQueue.filter((id) => id !== playerId);

  const remainingActivePlayers = activePlayers(match).length;
  if (remainingActivePlayers < 2) {
    const winner = activePlayers(match)[0];
    if (!winner) {
      match.status = "finished";
      return { remainingActivePlayers, finished: true, advanced: false };
    }
    awardHoleWin(match, winner.id);
    if (hole.number >= match.holesToPlay) {
      match.status = "finished";
      return { remainingActivePlayers, finished: true, winnerId: winner.id, advanced: false };
    }
    // Keep the scored hole on the table so everyone can see every hand before
    // the next deal. The next-hole action starts the following round.
    return { remainingActivePlayers, finished: false, winnerId: winner.id, advanced: false };
  }

  if (currentPlayer(match).id === playerId) {
    if (hole.finalTurnQueue) {
      if (hole.finalTurnQueue.length === 0) scoreHole(match);
      else hole.currentPlayerIndex = match.players.findIndex((player) => player.id === hole.finalTurnQueue?.[0]);
    } else {
      hole.currentPlayerIndex = nextActivePlayerIndex(match, hole.currentPlayerIndex);
    }
  }
  return { remainingActivePlayers, finished: match.status === "finished", advanced: false };
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
  if (hole.pendingMatchGift?.playerId === playerId) {
    const pendingGift = hole.pendingMatchGift;
    hole.layouts[pendingGift.targetPlayerId][pendingGift.targetLayoutIndex] = pendingGift.matchedCard;
    hole.pendingMatchGift = undefined;
  } else if (hole.pendingMatchGift?.targetPlayerId === playerId) {
    hole.pendingMatchGift = undefined;
  }
  const clearedPendingPower = hole.pendingPower?.playerId === playerId;

  match.players.splice(leavingIndex, 1);
  delete hole.layouts[playerId];
  if (hole.scores) delete hole.scores[playerId];
  hole.peekedPlayerIds = hole.peekedPlayerIds.filter((id) => id !== playerId);
  if (hole.knockerId === playerId) hole.knockerId = undefined;
  match.eliminatedPlayerIds = (match.eliminatedPlayerIds ?? []).filter((id) => id !== playerId);
  if (clearedPendingPower) hole.pendingPower = undefined;
  hole.pendingPowerQueue = hole.pendingPowerQueue?.filter((power) => power.playerId !== playerId);
  if (hole.finalTurnQueue) hole.finalTurnQueue = hole.finalTurnQueue.filter((id) => id !== playerId);

  if (activePlayers(match).length < 2) {
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
  if (match.eliminatedPlayerIds) match.eliminatedPlayerIds = match.eliminatedPlayerIds.map((id) => idMap.get(id) ?? id);
  if (hole.pendingPower) hole.pendingPower.playerId = idMap.get(hole.pendingPower.playerId) ?? hole.pendingPower.playerId;
  if (hole.pendingPowerQueue) {
    hole.pendingPowerQueue = hole.pendingPowerQueue.map((power) => ({
      ...power,
      playerId: idMap.get(power.playerId) ?? power.playerId,
    }));
  }
  if (hole.pendingMatchGift) {
    hole.pendingMatchGift.playerId = idMap.get(hole.pendingMatchGift.playerId) ?? hole.pendingMatchGift.playerId;
    hole.pendingMatchGift.targetPlayerId = idMap.get(hole.pendingMatchGift.targetPlayerId) ?? hole.pendingMatchGift.targetPlayerId;
  }
  if (hole.finalTurnQueue) hole.finalTurnQueue = hole.finalTurnQueue.map((id) => idMap.get(id) ?? id);
  if (hole.scores) hole.scores = Object.fromEntries(Object.entries(hole.scores).map(([id, score]) => [idMap.get(id) ?? id, score]));

  if (hole.status === "playing") {
    if (hole.finalTurnQueue) {
      if (hole.finalTurnQueue.length === 0) {
        hole.finalMatchDeadline ??= Date.now() + 5_000;
      } else {
        hole.currentPlayerIndex = match.players.findIndex((player) => player.id === hole.finalTurnQueue?.[0]);
      }
    } else if (leavingIndex < hole.currentPlayerIndex) {
      hole.currentPlayerIndex -= 1;
    } else if (leavingIndex === hole.currentPlayerIndex) {
      hole.currentPlayerIndex %= match.players.length;
    }
    if (match.status === "playing" && isEliminated(match, currentPlayer(match).id)) {
      hole.currentPlayerIndex = nextActivePlayerIndex(match, hole.currentPlayerIndex);
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
      hole.finalMatchDeadline = Date.now() + 5_000;
      return;
    }
    hole.currentPlayerIndex = players.findIndex((player) => player.id === hole.finalTurnQueue?.[0]);
    activateQueuedPower(match);
    return;
  }
  hole.currentPlayerIndex = nextActivePlayerIndex(match, hole.currentPlayerIndex);
  activateQueuedPower(match);
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

function assertActivePlayer(match: MatchState, playerId: string): void {
  assertPlayer(match, playerId);
  if (isEliminated(match, playerId)) throw new GolfRuleError("This player is out of the game.");
}

function assertTurn(match: MatchState, playerId: string): void {
  assertActivePlayer(match, playerId);
  if (currentPlayer(match).id !== playerId) throw new GolfRuleError("It is not this player's turn.");
}

function assertCanDraw(match: MatchState, playerId: string): void {
  assertPlaying(match);
  assertTurn(match, playerId);
  assertInitialPeekComplete(match);
  if (match.hole.heldCard) throw new GolfRuleError("Resolve the drawn card before drawing again.");
  if (match.hole.pendingPower) throw new GolfRuleError("Use or skip the power card before drawing again.");
  if (match.hole.pendingMatchGift) throw new GolfRuleError("Finish the matching-card gift before drawing again.");
}

function assertInitialPeekComplete(match: MatchState): void {
  if (activePlayers(match).some((player) => !match.hole.peekedPlayerIds.includes(player.id))) {
    throw new GolfRuleError("Everyone must peek at their cards before the first turn begins.");
  }
}

function assertMatchingAvailable(match: MatchState): void {
  if (match.hole.finalMatchDeadline && Date.now() >= match.hole.finalMatchDeadline) {
    throw new GolfRuleError("The final matching window has closed.");
  }
  // A held stock card or another player's pending power never changes the
  // face-up discard. Matches are therefore legal during either state. An
  // opponent-match gift is the one exception: its empty slot must be filled
  // before another match can safely change the discard pile.
  if (match.hole.pendingMatchGift) {
    throw new GolfRuleError("Finish the matching-card gift before calling another match.");
  }
}

function activePlayers(match: MatchState): Player[] {
  return match.players.filter((player) => !isEliminated(match, player.id));
}

function awardHoleWin(match: MatchState, winnerId: string): Record<string, number> {
  const scores = Object.fromEntries(match.players.map((player) => [player.id, player.id === winnerId ? 1 : 0]));
  match.hole.scores = scores;
  match.hole.winnerId = winnerId;
  match.hole.status = "scored";
  const winner = match.players.find((player) => player.id === winnerId);
  if (!winner) throw new GolfRuleError("The hole winner is not at this table.");
  winner.totalScore += 1;
  return scores;
}

function drawTieBreakCard(match: MatchState): Card {
  const card = match.hole.stock.pop() ?? match.hole.discard.pop();
  if (!card) throw new GolfRuleError("There are no cards left for the tie-break.");
  return card;
}

function isEliminated(match: MatchState, playerId: string): boolean {
  return match.eliminatedPlayerIds?.includes(playerId) ?? false;
}

function nextActivePlayerIndex(match: MatchState, currentIndex: number): number {
  for (let offset = 1; offset <= match.players.length; offset += 1) {
    const index = (currentIndex + offset) % match.players.length;
    if (!isEliminated(match, match.players[index].id)) return index;
  }
  throw new GolfRuleError("No active players remain.");
}

function resolveDiscardPowerOrEndTurn(match: MatchState, playerId: string, discarded: Card): void {
  if (isPowerCard(discarded)) {
    match.hole.pendingPower = { rank: discarded.rank, playerId };
    return;
  }
  endTurn(match, playerId);
}

/**
 * A matched power card is resolved after the turn/power already in progress.
 * This preserves the order of play while allowing rapid calls against the
 * current discard (including several eights in a row).
 */
function queueMatchedPower(match: MatchState, playerId: string, card: Card): void {
  if (!isPowerCard(card)) return;
  match.hole.pendingPowerQueue ??= [];
  match.hole.pendingPowerQueue.push({ rank: card.rank, playerId, endsTurn: false });
}

function completePower(match: MatchState, playerId: string): void {
  const power = match.hole.pendingPower;
  if (!power || power.playerId !== playerId) throw new GolfRuleError("There is no power card waiting for you.");
  match.hole.pendingPower = undefined;
  if (power.endsTurn === false) {
    activateQueuedPower(match);
    return;
  }
  endTurn(match, playerId);
}

function activateQueuedPower(match: MatchState): void {
  const { hole } = match;
  if (hole.pendingPower || hole.finalMatchDeadline) return;
  while (hole.pendingPowerQueue?.length) {
    const next = hole.pendingPowerQueue.shift();
    if (next && !isEliminated(match, next.playerId) && match.players.some((player) => player.id === next.playerId)) {
      hole.pendingPower = next;
      break;
    }
  }
  if (hole.pendingPowerQueue?.length === 0) hole.pendingPowerQueue = undefined;
}

function isPowerCard(card: Card): card is Card & { rank: PowerRank } {
  return card.rank === "8" || card.rank === "J" || card.rank === "Q";
}

function assertPendingPower(match: MatchState, playerId: string, expectedRank?: PowerRank, allowUsed = false): PendingPower {
  assertPlaying(match);
  assertActivePlayer(match, playerId);
  const power = match.hole.pendingPower;
  if (!power || power.playerId !== playerId) throw new GolfRuleError("There is no power card waiting for you.");
  if (power.used && !allowUsed) throw new GolfRuleError("Continue the turn after using this power card.");
  if (expectedRank && power.rank !== expectedRank) throw new GolfRuleError(`The ${power.rank} power must be resolved instead.`);
  return power;
}

function assertLayoutReference(match: MatchState, reference: LayoutCardReference): void {
  assertPlayer(match, reference.playerId);
  const layout = match.hole.layouts[reference.playerId];
  if (!Number.isInteger(reference.layoutIndex) || reference.layoutIndex < 0 || reference.layoutIndex >= layout.length) {
    throw new GolfRuleError("Choose a card that is still on the table.");
  }
  if (!layout[reference.layoutIndex]) throw new GolfRuleError("Choose a card that is still on the table.");
}
