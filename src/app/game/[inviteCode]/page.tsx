"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type CSSProperties, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { GameAction, GameView, PublicCard } from "../../../lib/golf/protocol";
import { copyText, playerProfile, savePlayerName } from "../../../lib/player-session";

type GameResponse = { view?: GameView; privatePeek?: PublicCard[]; error?: string };
type RecentReplacement = { eventId: string; layoutIndex: number; card: PublicCard };
type RecentPeek = { eventId: string; cards: PublicCard[] };

export default function GamePage() {
  const params = useParams<{ inviteCode: string }>();
  const router = useRouter();
  const inviteCode = params.inviteCode.toUpperCase();
  const [view, setView] = useState<GameView>();
  const [error, setError] = useState("");
  const [needsEntry, setNeedsEntry] = useState(false);
  const [entryName, setEntryName] = useState(() => playerProfile().name);
  const [linkCopied, setLinkCopied] = useState(false);
  const [recentPeek, setRecentPeek] = useState<RecentPeek>();
  const [connectedPlayerIds, setConnectedPlayerIds] = useState<Set<string>>(new Set());
  const [recentReplacement, setRecentReplacement] = useState<RecentReplacement>();
  const [leaveConfirmation, setLeaveConfirmation] = useState(false);
  const isLeaving = useRef(false);
  const hasJoinedTable = Boolean(view);

  const refreshGame = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${inviteCode}/game?playerId=${playerProfile().id}`, { cache: "no-store" });
      const data = await response.json() as GameResponse;
      if (!response.ok || !data.view) {
        if (data.error === "Enter this table before viewing it.") {
          setNeedsEntry(true);
          return setError("");
        }
        return setError(data.error || "Unable to load this game.");
      }
      setView(data.view);
      setNeedsEntry(false);
      setError("");
    } catch {
      setError("Connection lost. Retrying…");
    }
  }, [inviteCode]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshGame(), 0);
    const refresh = window.setInterval(() => void refreshGame(), 2_000);
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(refresh); };
  }, [refreshGame]);

  useEffect(() => {
    if (!hasJoinedTable) return;
    const socket = io({ path: "/socket.io" });
    const watchRoom = () => {
      socket.emit("identify", playerProfile());
      socket.emit("watch:room", inviteCode);
    };
    socket.on("connect", watchRoom);
    socket.on("room:update", () => void refreshGame());
    socket.on("presence:update", (playerIds: string[]) => setConnectedPlayerIds(new Set(playerIds)));
    return () => { socket.disconnect(); };
  }, [hasJoinedTable, inviteCode, refreshGame]);

  useEffect(() => {
    if (!view?.game) return;
    const confirmExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leaveOnExit = () => {
      if (isLeaving.current) return;
      isLeaving.current = true;
      void fetch(`/api/rooms/${inviteCode}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerProfile().id }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", confirmExit);
    window.addEventListener("pagehide", leaveOnExit);
    return () => {
      window.removeEventListener("beforeunload", confirmExit);
      window.removeEventListener("pagehide", leaveOnExit);
    };
  }, [inviteCode, view?.game]);

  async function joinTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = playerProfile();
    const playerName = entryName.trim() || "Guest";
    try {
      const response = await fetch(`/api/rooms/${inviteCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: profile.id, playerName, accessCode: inviteCode }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) return setError(data.error || "Unable to enter this table.");
      savePlayerName(playerName);
      setNeedsEntry(false);
      void refreshGame();
    } catch {
      setError("Unable to reach this table. Please try again.");
    }
  }

  async function copyGameLink() {
    try {
      await copyText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1_600);
    } catch {
      setError("Copy the address from your browser to share this game.");
    }
  }

  async function leaveTable() {
    if (isLeaving.current) return;
    isLeaving.current = true;
    try {
      await fetch(`/api/rooms/${inviteCode}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerProfile().id }),
      });
    } finally {
      router.push("/");
    }
  }

  async function sendAction(action: GameAction) {
    const replacementCard = action.type === "replace" ? view?.game?.heldCard : undefined;
    const response = await fetch(`/api/rooms/${inviteCode}/game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerProfile().id, action }),
    });
    const data = await response.json() as GameResponse;
    if (!response.ok || !data.view) return setError(data.error || "That action is not available.");
    setView(data.view);
    if (action.type === "replace" && replacementCard && data.view.game?.lastEvent?.id) {
      const placement = { eventId: data.view.game.lastEvent.id, layoutIndex: action.layoutIndex, card: replacementCard };
      setRecentReplacement(placement);
      window.setTimeout(() => setRecentReplacement((current) => current?.eventId === placement.eventId ? undefined : current), 1_500);
    }
    if (action.type === "peek" && data.privatePeek && data.view.game?.lastEvent?.id) {
      const peek = { eventId: data.view.game.lastEvent.id, cards: data.privatePeek };
      setRecentPeek(peek);
      window.setTimeout(() => setRecentPeek((current) => current?.eventId === peek.eventId ? undefined : current), 1_500);
    }
    setError("");
  }

  if (!view && needsEntry) return <main className="game-loading"><section className="table-entry"><p>TABLE INVITE</p><h1>ENTER GAME</h1><form onSubmit={joinTable}><label>YOUR NAME<input autoFocus value={entryName} maxLength={24} onChange={(event) => setEntryName(event.target.value)} placeholder="Guest" /></label><button type="submit">ENTER TABLE →</button></form>{error && <p className="table-entry-error">{error}</p>}</section></main>;
  if (!view) return <main className="game-loading"><p>CONNECTING TO TABLE…</p>{error && <small>{error}</small>}</main>;
  const game = view.game;
  const seatedPlayers = game ? arrangeSeats(game.players) : [];

  return <main className="game-screen">
    <header className="game-header"><Link href="/" className="back-link" onClick={(event) => { event.preventDefault(); if (game) setLeaveConfirmation(true); else void leaveTable(); }}>← LOBBY</Link><div><strong>{view.room.name}</strong><small className="game-invite-code">{view.room.inviteCode}</small></div><button className="copy-game-link" onClick={() => void copyGameLink()}>{linkCopied ? "LINK COPIED" : "COPY GAME LINK"}</button></header>
    {!game ? <section className="start-panel"><p>TABLE LOBBY</p><h1>{view.room.name}</h1><div className="waiting-players">{view.room.players.map((player) => <span key={player.id}>{player.name}</span>)}</div>{view.canStart ? <button onClick={() => sendAction({ type: "start" })}>START GAME →</button> : <p className="wait-copy">Waiting for {view.room.players[0]?.name} to start the game.</p>}{error && <p className="game-error">{error}</p>}</section> : <>
      <section className="table-status"><span>{game.isPeeking ? `PEEK PHASE ${game.peekedPlayers}/${game.players.length}` : game.phase === "scored" ? "HOLE COMPLETE" : game.currentPlayerName === "" ? "" : `${game.currentPlayerName}'S TURN`}</span><span>STOCK {game.stockCount}</span>{game.knockerName && <span>{game.knockerName} KNOCKED</span>}</section>
      <section className={`digital-table circular-table ${seatedPlayers.length > 8 ? "seating-dense" : seatedPlayers.length > 5 ? "seating-compact" : ""}`}>
        <div className="center-table">
          <div className="center-piles"><div><p>STOCK</p><div key={game.lastEvent?.type === "draw-stock" ? game.lastEvent.id : "stock"} className={`stock-card ${game.lastEvent?.type === "draw-stock" ? "action-card-highlight" : ""}`}>?</div></div><div><p>DISCARD</p><span key={["take-discard", "replace", "discard-drawn"].includes(game.lastEvent?.type || "") ? game.lastEvent?.id : "discard"} className={["take-discard", "replace", "discard-drawn"].includes(game.lastEvent?.type || "") ? "action-card-highlight" : ""}><Card card={game.discard} /></span></div></div>
          <div className="table-activity" key={game.lastEvent?.id || "opening-play"}><span>TABLE FEED</span><strong>{game.lastEvent?.message || "Cards are on the table."}</strong><small>{game.currentPlayerName ? `${game.currentPlayerName.toUpperCase()} IS UP` : "WAITING FOR THE NEXT PLAY"}</small></div>
        </div>
        {seatedPlayers.map((player, index) => <article className={`table-player table-seat ${player.isYou ? "is-you" : ""} ${game.lastEvent?.playerId === player.id && ["peek", "knock"].includes(game.lastEvent.type || "") ? "action-player-highlight" : ""}`} style={seatPosition(index, seatedPlayers.length)} key={player.id}><header><span><i className={`presence-dot ${connectedPlayerIds.has(player.id) ? "online" : ""}`} />{player.name}{player.isYou ? " (YOU)" : ""}</span>{player.score !== undefined && <b>{player.score} PTS</b>}</header><div className="layout-cards">{player.cards.map((card, cardIndex) => {
          const replacement = game.lastEvent?.type === "replace" && game.lastEvent.playerId === player.id && game.lastEvent.layoutIndex === cardIndex;
          const peekedCard = game.lastEvent?.type === "peek" && game.lastEvent.playerId === player.id && cardIndex >= 2;
          const highlighted = replacement || peekedCard;
          const replacementCard = player.isYou && replacement && recentReplacement && recentReplacement.eventId === game.lastEvent?.id && recentReplacement.layoutIndex === cardIndex ? recentReplacement.card : undefined;
          const peekCard = player.isYou && peekedCard && recentPeek && recentPeek.eventId === game.lastEvent?.id ? recentPeek.cards[cardIndex - 2] : undefined;
          const displayedCard = replacementCard || peekCard || card;
          return <button key={`${cardIndex}-${highlighted ? game.lastEvent?.id : "idle"}`} disabled={!player.isYou || !game.canAct || !game.heldCard || game.phase !== "playing"} onClick={() => sendAction({ type: "replace", layoutIndex: cardIndex })} className={`layout-card ${highlighted ? "action-card-highlight" : ""} ${replacementCard ? "placed-card" : ""} ${peekCard ? "peeked-card" : ""}`}><Card card={displayedCard} /></button>;
        })}</div></article>)}
      </section>
      <section className="turn-controls">
        {game.phase === "scored" ? <button onClick={() => sendAction({ type: "next-hole" })}>NEXT HOLE →</button> : <>{game.canPeek && <button className="outline" onClick={() => sendAction({ type: "peek" })}>PEEK AT CARDS</button>}{game.isPeeking && <p>Everyone must peek at two cards before play begins.</p>}{game.canAct && !game.heldCard && <><button onClick={() => sendAction({ type: "draw-stock" })}>DRAW STOCK</button><button onClick={() => sendAction({ type: "take-discard" })}>TAKE DISCARD</button><button className="outline" onClick={() => sendAction({ type: "knock" })}>KNOCK</button></>}{game.canAct && game.heldCard && <><div className="held-card"><span>DRAWN CARD</span><Card card={game.heldCard} /></div>{game.heldCardSource === "stock" && <button className="outline" onClick={() => sendAction({ type: "discard-drawn" })}>DISCARD DRAWN CARD</button>}<p>Choose one of your cards to replace.</p></>}</>}
      </section>
      {error && <p className="game-error">{error}</p>}
    </>}
    {leaveConfirmation && <div className="leave-game-overlay" role="dialog" aria-modal="true" aria-labelledby="leave-game-title"><section><p>LEAVING MID-GAME</p><h2 id="leave-game-title">LEAVE THIS GAME?</h2><span>You will be removed from the table for every player.</span><div><button type="button" className="stay-button" onClick={() => setLeaveConfirmation(false)}>STAY</button><button type="button" className="leave-button" onClick={() => void leaveTable()}>LEAVE GAME</button></div></section></div>}
  </main>;
}

function Card({ card }: { card: PublicCard | null }) {
  if (!card) return <span className="game-card-back">?</span>;
  const suit = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[card.suit];
  return <span className={`game-face-card ${card.suit === "diamonds" || card.suit === "hearts" ? "red" : ""}`}><b>{card.rank}</b><i>{suit}</i></span>;
}

function arrangeSeats<T extends { isYou: boolean }>(players: T[]): T[] {
  const yourIndex = players.findIndex((player) => player.isYou);
  if (yourIndex < 0) return players;
  return [...players.slice(yourIndex), ...players.slice(0, yourIndex)];
}

function seatPosition(index: number, total: number): CSSProperties {
  const angle = ((90 + (index * 360) / total) * Math.PI) / 180;
  const radiusX = total > 8 ? 43 : total > 5 ? 40 : 36;
  const radiusY = total > 8 ? 40 : total > 5 ? 37 : 33;
  return { left: `${50 + Math.cos(angle) * radiusX}%`, top: `${50 + Math.sin(angle) * radiusY}%` };
}
