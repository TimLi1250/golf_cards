"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type CSSProperties, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { GameAction, GameView, PublicCard } from "../../../lib/golf/protocol";
import { copyText, playerProfile, savePlayerName } from "../../../lib/player-session";

type GameResponse = { view?: GameView; needsEntry?: boolean; privatePeek?: PublicCard[]; privatePowerPeek?: { playerId: string; layoutIndex: number; card: PublicCard }; error?: string };
type RecentReplacement = { eventId: string; layoutIndex: number; card: PublicCard };
type RecentPeek = { eventId: string; cards: PublicCard[] };
type RecentPowerPeek = { eventId: string; playerId: string; layoutIndex: number; card: PublicCard };
type CardSelection = { playerId: string; layoutIndex: number };

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
  const [recentPowerPeek, setRecentPowerPeek] = useState<RecentPowerPeek>();
  const [powerSwapSelection, setPowerSwapSelection] = useState<CardSelection>();
  const [matchTarget, setMatchTarget] = useState<CardSelection>();
  const [connectedPlayerIds, setConnectedPlayerIds] = useState<Set<string>>(new Set());
  const [recentReplacement, setRecentReplacement] = useState<RecentReplacement>();
  const [leaveConfirmation, setLeaveConfirmation] = useState(false);
  const isLeaving = useRef(false);
  const hasJoinedTable = Boolean(view);

  const refreshGame = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${inviteCode}/game?playerId=${playerProfile().id}`, { cache: "no-store" });
      const data = await response.json() as GameResponse;
      if (data.needsEntry) {
        setNeedsEntry(true);
        return setError("");
      }
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
    if (needsEntry) return;
    const initialRefresh = window.setTimeout(() => void refreshGame(), 0);
    const refresh = window.setInterval(() => void refreshGame(), 2_000);
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(refresh); };
  }, [needsEntry, refreshGame]);

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
    if (action.type === "use-peek-power" && data.privatePowerPeek && data.view.game?.lastEvent?.id) {
      const peek = { eventId: data.view.game.lastEvent.id, ...data.privatePowerPeek };
      setRecentPowerPeek(peek);
      window.setTimeout(() => setRecentPowerPeek((current) => current?.eventId === peek.eventId ? undefined : current), 1_500);
    }
    setError("");
  }

  if (!view && needsEntry) return <main className="game-loading"><section className="table-entry"><p>TABLE INVITE</p><h1>ENTER GAME</h1><form onSubmit={joinTable}><label>YOUR NAME<input autoFocus value={entryName} maxLength={24} onChange={(event) => setEntryName(event.target.value)} placeholder="Guest" /></label><button type="submit">ENTER TABLE →</button></form>{error && <p className="table-entry-error">{error}</p>}</section></main>;
  if (!view) return <main className="game-loading"><p>CONNECTING TO TABLE…</p>{error && <small>{error}</small>}</main>;
  const game = view.game;
  const seatedPlayers = game ? arrangeSeats(game.players) : [];

  function handleCardClick(playerId: string, isYou: boolean, isOut: boolean, layoutIndex: number) {
    if (!game || game.phase !== "playing") return;
    if (isOut) return;
    if (game.canUsePower && game.pendingPower) {
      if (game.pendingPower.rank === "8") {
        const picked = { playerId, layoutIndex };
        if (!powerSwapSelection) return setPowerSwapSelection(picked);
        if (powerSwapSelection.playerId === playerId && powerSwapSelection.layoutIndex === layoutIndex) return setPowerSwapSelection(undefined);
        setPowerSwapSelection(undefined);
        void sendAction({ type: "use-swap-power", first: powerSwapSelection, second: picked });
        return;
      }
      if (game.pendingPower.rank === "J" && !isYou) return setError("A Jack can only reveal one of your own cards.");
      void sendAction({ type: "use-peek-power", targetPlayerId: playerId, layoutIndex });
      return;
    }
    if (matchTarget) {
      if (isYou) {
        const target = matchTarget;
        setMatchTarget(undefined);
        void sendAction({ type: "match-other", targetPlayerId: target.playerId, targetLayoutIndex: target.layoutIndex, giftLayoutIndex: layoutIndex });
      } else {
        setMatchTarget({ playerId, layoutIndex });
      }
      return;
    }
    if (isYou && game.canAct && game.heldCard) {
      void sendAction({ type: "replace", layoutIndex });
      return;
    }
    if (!game.canMatch) return;
    if (isYou) void sendAction({ type: "match-own", layoutIndex });
    else setMatchTarget({ playerId, layoutIndex });
  }

  return <main className="game-screen">
    <header className="game-header"><Link href="/" className="back-link" onClick={(event) => { event.preventDefault(); if (game) setLeaveConfirmation(true); else void leaveTable(); }}>← LOBBY</Link><div><strong>{view.room.name}</strong><small className="game-invite-code">{view.room.inviteCode}</small></div><button className="copy-game-link" onClick={() => void copyGameLink()}>{linkCopied ? "LINK COPIED" : "COPY GAME LINK"}</button></header>
    {!game ? <section className="start-panel"><p>TABLE LOBBY</p><h1>{view.room.name}</h1><div className="waiting-players">{view.room.players.map((player) => <span key={player.id}>{player.name}</span>)}</div>{view.canStart ? <button onClick={() => sendAction({ type: "start" })}>START GAME →</button> : <p className="wait-copy">Waiting for {view.room.players[0]?.name} to start the game.</p>}{error && <p className="game-error">{error}</p>}</section> : <>
      <section className="table-status"><span>{game.phase === "finished" ? "GAME OVER" : game.isPeeking ? `PEEK PHASE ${game.peekedPlayers}/${game.activePlayerCount}` : game.phase === "scored" ? `${game.holeWinnerName || "A PLAYER"} WINS${game.tieBreakRounds ? ` AFTER ${game.tieBreakRounds} TIE-BREAK${game.tieBreakRounds > 1 ? "S" : ""}` : ""}` : game.currentPlayerName === "" ? "" : `${game.currentPlayerName}'S TURN`}</span><span>STOCK {game.stockCount}</span>{game.knockerName && <span>{game.knockerName} KNOCKED</span>}</section>
      {game.phase === "scored" && game.tieBreaks?.map((round, roundIndex) => <section className="tie-break-results" key={roundIndex}><b>TIE BREAK {roundIndex + 1}</b>{round.map(({ playerName, card }) => <span key={`${playerName}-${card.rank}-${card.suit}`}><small>{playerName}</small><Card card={card} /></span>)}</section>)}
      <section className="scoreboard" aria-label="Scoreboard"><span>HOLE WINS</span>{seatedPlayers.map((player) => <div className={`${player.isYou ? "is-you" : ""} ${player.isOut ? "is-out" : ""}`} key={player.id}><b>{player.name}{player.isYou ? " (YOU)" : ""}</b><strong>{player.isOut ? "OUT" : player.totalScore}</strong></div>)}</section>
      <section className={`digital-table circular-table ${seatedPlayers.length > 8 ? "seating-dense" : seatedPlayers.length > 5 ? "seating-compact" : ""}`}>
        <div className="center-table">
          <div className="center-piles"><div><p>STOCK</p><div key={game.lastEvent?.type === "draw-stock" ? game.lastEvent.id : "stock"} className={`stock-card ${game.lastEvent?.type === "draw-stock" ? "action-card-highlight" : ""}`}>?</div></div><div><p>DISCARD</p><span key={["take-discard", "replace", "discard-drawn"].includes(game.lastEvent?.type || "") ? game.lastEvent?.id : "discard"} className={["take-discard", "replace", "discard-drawn"].includes(game.lastEvent?.type || "") ? "action-card-highlight" : ""}><Card card={game.discard} /></span></div></div>
          <div className="table-activity" key={game.lastEvent?.id || "opening-play"}><span>TABLE FEED</span><strong>{game.lastEvent?.message || "Cards are on the table."}</strong><small>{game.currentPlayerName ? `${game.currentPlayerName.toUpperCase()} IS UP` : "WAITING FOR THE NEXT PLAY"}</small></div>
        </div>
        {seatedPlayers.map((player, index) => <article className={`table-player table-seat ${player.isYou ? "is-you" : ""} ${player.isOut ? "is-out" : ""} ${game.lastEvent?.playerId === player.id && ["peek", "knock"].includes(game.lastEvent.type || "") ? "action-player-highlight" : ""}`} style={seatPosition(index, seatedPlayers.length)} key={player.id}><header><span><i className={`presence-dot ${connectedPlayerIds.has(player.id) ? "online" : ""}`} />{player.name}{player.isYou ? " (YOU)" : ""}</span>{player.isOut ? <b>OUT</b> : player.score !== undefined && <b>{player.score} PTS</b>}</header><div className="layout-cards">{player.cards.map((card, cardIndex) => {
          const replacement = game.lastEvent?.type === "replace" && game.lastEvent.playerId === player.id && game.lastEvent.layoutIndex === cardIndex;
          const peekedCard = game.lastEvent?.type === "peek" && game.lastEvent.playerId === player.id && cardIndex >= 2;
          const powerAffected = game.lastEvent?.affectedCards?.some((affected) => affected.playerId === player.id && affected.layoutIndex === cardIndex);
          const highlighted = replacement || peekedCard || powerAffected;
          const replacementCard = player.isYou && replacement && recentReplacement && recentReplacement.eventId === game.lastEvent?.id && recentReplacement.layoutIndex === cardIndex ? recentReplacement.card : undefined;
          const peekCard = player.isYou && peekedCard && recentPeek && recentPeek.eventId === game.lastEvent?.id ? recentPeek.cards[cardIndex - 2] : undefined;
          const powerPeekCard = recentPowerPeek && recentPowerPeek.eventId === game.lastEvent?.id && recentPowerPeek.playerId === player.id && recentPowerPeek.layoutIndex === cardIndex ? recentPowerPeek.card : undefined;
          const selectedForSwap = powerSwapSelection?.playerId === player.id && powerSwapSelection.layoutIndex === cardIndex;
          const selectedForMatch = matchTarget?.playerId === player.id && matchTarget.layoutIndex === cardIndex;
          const displayedCard = replacementCard || peekCard || powerPeekCard || card;
          const canSelect = !player.isOut && game.phase === "playing" && (game.canUsePower || Boolean(matchTarget) || (player.isYou && game.canAct && game.heldCard) || game.canMatch);
          return <button key={`${cardIndex}-${highlighted ? game.lastEvent?.id : "idle"}`} disabled={!canSelect} onClick={() => handleCardClick(player.id, player.isYou, player.isOut, cardIndex)} className={`layout-card ${highlighted ? "action-card-highlight" : ""} ${replacementCard ? "placed-card" : ""} ${peekCard || powerPeekCard ? "peeked-card" : ""} ${selectedForSwap || selectedForMatch ? "selected-table-card" : ""}`}><Card card={displayedCard} /></button>;
        })}</div></article>)}
      </section>
      <section className="turn-controls">
        {game.phase === "scored" ? <button onClick={() => sendAction({ type: "next-hole" })}>NEXT HOLE →</button> : <>
          {game.canPeek && <button className="outline" onClick={() => sendAction({ type: "peek" })}>PEEK AT CARDS</button>}
          {game.isPeeking && <p>Everyone must peek at two cards before play begins.</p>}
          {game.canUsePower && game.pendingPower?.rank === "8" && <><p>8 POWER: {powerSwapSelection ? "choose one more card to swap, or choose this card again to cancel." : "choose any two cards to swap face-down."}</p><button className="outline" onClick={() => { setPowerSwapSelection(undefined); void sendAction({ type: "skip-power" }); }}>DON&apos;T SWAP</button></>}
          {game.canUsePower && (game.pendingPower?.rank === "J" || game.pendingPower?.rank === "Q") && <><p>{game.pendingPower.rank} POWER: click {game.pendingPower.rank === "J" ? "one of your own cards" : "one card at the table"} to peek at it.</p><button className="outline" onClick={() => void sendAction({ type: "skip-power" })}>SKIP PEEK</button></>}
          {matchTarget && <><p>MATCH CALL: now choose one of your own cards to give to {game.players.find((player) => player.id === matchTarget.playerId)?.name || "that player"}.</p><button className="outline" onClick={() => setMatchTarget(undefined)}>CANCEL MATCH</button></>}
          {game.canAct && !game.heldCard && !game.pendingPower && <><button onClick={() => sendAction({ type: "draw-stock" })}>DRAW STOCK</button><button onClick={() => sendAction({ type: "take-discard" })}>TAKE DISCARD</button><button className="outline" onClick={() => sendAction({ type: "knock" })}>KNOCK</button></>}
          {game.canAct && game.heldCard && <><div className="held-card"><span>DRAWN CARD</span><Card card={game.heldCard} /></div>{game.heldCardSource === "stock" && <button className="outline" onClick={() => sendAction({ type: "discard-drawn" })}>DISCARD DRAWN CARD</button>}<p>Choose one of your cards to replace.</p></>}
          {game.canMatch && !matchTarget && <p className="match-hint">MATCH THE DISCARD: click one of your cards, or click another player&apos;s card and then one of yours.</p>}
        </>}
      </section>
      {error && <p className="game-error">{error}</p>}
    </>}
    {leaveConfirmation && <div className="leave-game-overlay" role="dialog" aria-modal="true" aria-labelledby="leave-game-title"><section><p>LEAVING MID-GAME</p><h2 id="leave-game-title">LEAVE THIS GAME?</h2><span>You will be removed from the table for every player.</span><div><button type="button" className="stay-button" onClick={() => setLeaveConfirmation(false)}>STAY</button><button type="button" className="leave-button" onClick={() => void leaveTable()}>LEAVE GAME</button></div></section></div>}
  </main>;
}

function Card({ card }: { card: PublicCard | null }) {
  if (!card) return <span className="game-card-back">?</span>;
  const suit = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠", joker: "★" }[card.suit];
  return <span className={`game-face-card ${card.suit === "diamonds" || card.suit === "hearts" ? "red" : ""}`}><b>{card.rank}</b><i>{suit}</i></span>;
}

function arrangeSeats<T extends { isYou: boolean }>(players: T[]): T[] {
  const yourIndex = players.findIndex((player) => player.isYou);
  if (yourIndex < 0) return players;
  return [...players.slice(yourIndex), ...players.slice(0, yourIndex)];
}

function seatPosition(index: number, total: number): CSSProperties {
  const degrees = 90 + (index * 360) / total;
  const angle = (degrees * Math.PI) / 180;
  const radiusX = total > 8 ? 43 : total > 5 ? 40 : 36;
  const radiusY = total > 8 ? 40 : total > 5 ? 37 : 33;
  return { left: `${50 + Math.cos(angle) * radiusX}%`, top: `${50 + Math.sin(angle) * radiusY}%`, "--seat-card-rotation": `${degrees - 90}deg` } as CSSProperties;
}
