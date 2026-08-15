"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { GameAction, GameView, PublicCard } from "../../../lib/golf/protocol";

type GameResponse = { view?: GameView; privatePeek?: PublicCard[]; error?: string };

export default function GamePage() {
  const params = useParams<{ inviteCode: string }>();
  const inviteCode = params.inviteCode.toUpperCase();
  const [view, setView] = useState<GameView>();
  const [error, setError] = useState("");
  const [peekedCards, setPeekedCards] = useState<PublicCard[]>();
  const [connectedPlayerIds, setConnectedPlayerIds] = useState<Set<string>>(new Set());

  const refreshGame = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${inviteCode}/game?playerId=${playerSessionId()}`, { cache: "no-store" });
      const data = await response.json() as GameResponse;
      if (!response.ok || !data.view) return setError(data.error || "Unable to load this game.");
      setView(data.view);
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
    const socket = io({ path: "/socket.io" });
    const watchRoom = () => {
      socket.emit("identify", playerSessionId());
      socket.emit("watch:room", inviteCode);
    };
    socket.on("connect", watchRoom);
    socket.on("room:update", () => void refreshGame());
    socket.on("presence:update", (playerIds: string[]) => setConnectedPlayerIds(new Set(playerIds)));
    return () => { socket.disconnect(); };
  }, [inviteCode, refreshGame]);

  async function sendAction(action: GameAction) {
    const response = await fetch(`/api/rooms/${inviteCode}/game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerSessionId(), action }),
    });
    const data = await response.json() as GameResponse;
    if (!response.ok || !data.view) return setError(data.error || "That action is not available.");
    setView(data.view);
    setError("");
    if (data.privatePeek) setPeekedCards(data.privatePeek);
  }

  if (!view) return <main className="game-loading"><p>CONNECTING TO TABLE…</p>{error && <small>{error}</small>}</main>;
  const game = view.game;

  return <main className="game-screen">
    <header className="game-header"><Link href="/" className="back-link">← LOBBY</Link><div><strong>{view.room.name}</strong><small>CODE: {view.room.inviteCode}</small></div><span>{game ? `HOLE ${game.holeNumber} / ${game.holesToPlay}` : "LOBBY"}</span></header>
    {!game ? <section className="start-panel"><p>TABLE LOBBY</p><h1>{view.room.name}</h1><div className="waiting-players">{view.room.players.map((player) => <span key={player.id}>{player.name}</span>)}</div>{view.canStart ? <button onClick={() => sendAction({ type: "start" })}>START GAME →</button> : <p className="wait-copy">Waiting for {view.room.players[0]?.name} to start the game.</p>}{error && <p className="game-error">{error}</p>}</section> : <>
      <section className="table-status"><span>{game.phase === "scored" ? "HOLE COMPLETE" : game.currentPlayerName === "" ? "" : `${game.currentPlayerName}'S TURN`}</span><span>STOCK {game.stockCount}</span>{game.knockerName && <span>{game.knockerName} KNOCKED</span>}</section>
      <section className="digital-table">
        <div className="discard-area"><p>STOCK</p><div className="stock-card">?</div><p>DISCARD</p><Card card={game.discard} /></div>
        <div className="table-players">{game.players.map((player) => <article className={`table-player ${player.isYou ? "is-you" : ""}`} key={player.id}><header><span><i className={`presence-dot ${connectedPlayerIds.has(player.id) ? "online" : ""}`} />{player.name}{player.isYou ? " (YOU)" : ""}</span>{player.score !== undefined && <b>{player.score} PTS</b>}</header><div className="layout-cards">{player.cards.map((card, index) => <button key={index} disabled={!player.isYou || !game.canAct || !game.heldCard || game.phase !== "playing"} onClick={() => sendAction({ type: "replace", layoutIndex: index })} className="layout-card"><Card card={card} /></button>)}</div></article>)}</div>
      </section>
      <section className="turn-controls">
        {game.phase === "scored" ? <button onClick={() => sendAction({ type: "next-hole" })}>NEXT HOLE →</button> : <>{game.canPeek && <button className="outline" onClick={() => sendAction({ type: "peek" })}>PEEK AT CARDS</button>}{game.canAct && !game.heldCard && <><button onClick={() => sendAction({ type: "draw-stock" })}>DRAW STOCK</button><button onClick={() => sendAction({ type: "take-discard" })}>TAKE DISCARD</button><button className="outline" onClick={() => sendAction({ type: "knock" })}>KNOCK</button></>}{game.canAct && game.heldCard && <><div className="held-card"><span>DRAWN CARD</span><Card card={game.heldCard} /></div>{game.heldCardSource === "stock" && <button className="outline" onClick={() => sendAction({ type: "discard-drawn" })}>DISCARD DRAWN CARD</button>}<p>Choose one of your cards to replace.</p></>}</>}
      </section>
      {error && <p className="game-error">{error}</p>}
    </>}
    {peekedCards && <div className="peek-overlay"><section><p>MEMORIZE THESE TWO CARDS</p><div>{peekedCards.map((card, index) => <Card key={index} card={card} />)}</div><button onClick={() => setPeekedCards(undefined)}>GOT IT</button></section></div>}
  </main>;
}

function Card({ card }: { card: PublicCard | null }) {
  if (!card) return <span className="game-card-back">?</span>;
  const suit = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[card.suit];
  return <span className={`game-face-card ${card.suit === "diamonds" || card.suit === "hearts" ? "red" : ""}`}><b>{card.rank}</b><i>{suit}</i></span>;
}

function playerSessionId(): string {
  const storageKey = "fairway-four-player-id";
  const savedId = window.localStorage.getItem(storageKey);
  if (savedId) return savedId;
  const playerId = crypto.randomUUID();
  window.localStorage.setItem(storageKey, playerId);
  return playerId;
}
