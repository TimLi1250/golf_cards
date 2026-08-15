export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

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

export type HoleState = {
  number: number;
  dealerIndex: number;
  deckCount: number;
  layouts: Record<string, Card[]>;
  stock: Card[];
  discard: Card[];
  currentPlayerIndex: number;
  heldCard?: { card: Card; source: CardSource };
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
};

const ranks: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits: Suit[] = ["clubs", "diamonds", "hearts", "spades"];

export class GolfRuleError extends Error {}

export function createDeck(deckCount = 1): Card[] {
  if (!Number.isInteger(deckCount) || deckCount < 1) {
    throw new GolfRuleError("At least one deck is required.");
  }
  return Array.from({ length: deckCount }, (_, deckIndex) =>
    suits.flatMap((suit) => ranks.map((rank) => ({ id: `${rank}-${suit}-${deckIndex + 1}`, rank, suit }))),
  ).flat();
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
  if (card.rank === "K") return 0;
  if (card.rank === "J" || card.rank === "Q") return 10;
  if (card.rank === "A") return 1;
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
  endTurn(match, playerId);
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
  endTurn(match, playerId);
}

export function knock(match: MatchState, playerId: string): void {
  assertPlaying(match);
  assertTurn(match, playerId);
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
  if (match.hole.heldCard) throw new GolfRuleError("Resolve the drawn card before drawing again.");
}
