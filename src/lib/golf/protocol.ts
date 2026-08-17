import type { Card } from "./engine";

export type PublicCard = Pick<Card, "rank" | "suit">;

export type TablePlayerView = {
  id: string;
  name: string;
  isYou: boolean;
  cardCount: number;
  cards: (PublicCard | null)[];
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
    holeNumber: number;
    holesToPlay: number;
    phase: "playing" | "scored" | "finished";
    lostPlayerName?: string;
    currentPlayerId?: string;
    currentPlayerName?: string;
    stockCount: number;
    discard: PublicCard;
    heldCard?: PublicCard;
    isPeeking: boolean;
    peekedPlayers: number;
    canPeek: boolean;
    canAct: boolean;
    heldCardSource?: "stock" | "discard";
    knockerName?: string;
    pendingPower?: {
      rank: "8" | "J" | "Q";
      playerId: string;
      playerName: string;
    };
    canUsePower: boolean;
    canMatch: boolean;
    lastEvent?: {
      id: string;
      message: string;
      playerId?: string;
      type?: "start" | "peek" | "draw-stock" | "take-discard" | "replace" | "discard-drawn" | "knock" | "next-hole" | "leave" | "power-swap" | "power-peek" | "skip-power" | "match-own" | "match-other";
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
  | { type: "use-swap-power"; first?: { playerId: string; layoutIndex: number }; second?: { playerId: string; layoutIndex: number } }
  | { type: "use-peek-power"; targetPlayerId: string; layoutIndex: number }
  | { type: "skip-power" }
  | { type: "match-own"; layoutIndex: number }
  | { type: "match-other"; targetPlayerId: string; targetLayoutIndex: number; giftLayoutIndex: number }
  | { type: "knock" }
  | { type: "next-hole" };
