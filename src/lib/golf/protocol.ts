import type { Card } from "./engine";

export type PublicCard = Pick<Card, "rank" | "suit">;

export type TablePlayerView = {
  id: string;
  name: string;
  isYou: boolean;
  cardCount: number;
  cards: (PublicCard | null)[];
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
    lastEvent?: {
      id: string;
      message: string;
      playerId?: string;
      type?: "start" | "peek" | "draw-stock" | "take-discard" | "replace" | "discard-drawn" | "knock" | "next-hole" | "leave";
      layoutIndex?: number;
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
  | { type: "knock" }
  | { type: "next-hole" };
