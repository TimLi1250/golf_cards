import type { Card } from "./engine";

export type PublicCard = Pick<Card, "rank" | "suit" | "jokerColor">;

export type TablePlayerView = {
  id: string;
  name: string;
  isYou: boolean;
  isOut: boolean;
  cardCount: number;
  cards: (PublicCard | null)[];
  occupiedSlots: boolean[];
  disconnectDeadline?: number;
  totalScore: number;
  score?: number;
};

export type GameView = {
  room: {
    inviteCode: string;
    name: string;
    status: "lobby" | "playing" | "finished";
    playerLimit: number;
    isPrivate: boolean;
    players: { id: string; name: string }[];
  };
  canStart: boolean;
  game?: {
    revision: number;
    holeNumber: number;
    holesToPlay: number;
    phase: "playing" | "scored" | "finished";
    holeWinnerName?: string;
    tieBreakRounds: number;
    tieBreaks?: { playerName: string; card: PublicCard }[][];
    currentPlayerId?: string;
    currentPlayerName?: string;
    stockCount: number;
    discard: PublicCard | null;
    heldCard?: PublicCard;
    isPeeking: boolean;
    peekedPlayers: number;
    activePlayerCount: number;
    canPeek: boolean;
    canAct: boolean;
    heldCardSource?: "stock" | "discard";
    knockerName?: string;
    finalMatchDeadline?: number;
    inactivityDeadline?: number;
    pendingPower?: {
      rank: "8" | "J" | "Q";
      playerId: string;
      playerName: string;
    };
    canUsePower: boolean;
    canCompletePower: boolean;
    canMatch: boolean;
    pendingMatchGift?: {
      playerId: string;
      playerName: string;
      targetPlayerId: string;
      targetPlayerName: string;
    };
    canGiveMatchCard: boolean;
    lastEvent?: {
      id: string;
      message: string;
      playerId?: string;
      type?: "start" | "peek" | "draw-stock" | "take-discard" | "replace" | "discard-drawn" | "keep-drawn" | "knock" | "finalize-knock" | "next-hole" | "leave" | "power-swap" | "power-peek" | "skip-power" | "match-own" | "match-other";
      layoutIndex?: number;
      affectedCards?: { playerId: string; layoutIndex: number }[];
    };
    players: TablePlayerView[];
  };
};

export type GameAction =
  | { type: "start" }
  | { type: "peek" }
  | { type: "draw-stock" }
  | { type: "take-discard" }
  | { type: "replace"; layoutIndex: number }
  | { type: "discard-drawn" }
  | { type: "keep-drawn" }
  | { type: "use-swap-power"; first?: { playerId: string; layoutIndex: number }; second?: { playerId: string; layoutIndex: number } }
  | { type: "use-peek-power"; targetPlayerId: string; layoutIndex: number }
  | { type: "skip-power" }
  | { type: "match-own"; layoutIndex: number }
  | { type: "claim-other-match"; targetPlayerId: string; layoutIndex: number }
  | { type: "give-match-card"; layoutIndex: number }
  | { type: "knock" }
  | { type: "finalize-knock" }
  | { type: "confirm-table-active" }
  | { type: "next-hole" };

export type MatchAction = Extract<GameAction, { type: "match-own" | "claim-other-match" }>;
