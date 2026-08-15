"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";

type Dialog = "host" | "join" | null;

type HostedGame = {
  id: string;
  name: string;
  host: string;
  playerLimit: number;
  inviteCode: string;
  players: { id: string; name: string }[];
};

export default function Home() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [gameName, setGameName] = useState("");
  const [playerLimit, setPlayerLimit] = useState(4);
  const [joinCode, setJoinCode] = useState("");
  const [notice, setNotice] = useState("");
  const [games, setGames] = useState<HostedGame[]>([]);

  const loadRooms = useCallback(async () => {
    try {
      const response = await fetch("/api/rooms", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { rooms: HostedGame[] };
      setGames(data.rooms);
    } catch {
      // The empty lobby remains usable if the local server is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void loadRooms(), 0);
    const refresh = window.setInterval(() => void loadRooms(), 4_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(refresh);
    };
  }, [loadRooms]);

  useEffect(() => {
    const socket = io({ path: "/socket.io" });
    const watchLobby = () => {
      socket.emit("identify", playerSessionId());
      socket.emit("watch:lobby");
    };
    socket.on("connect", watchLobby);
    socket.on("lobby:update", () => void loadRooms());
    return () => { socket.disconnect(); };
  }, [loadRooms]);

  async function hostGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const host = name.trim() || "Guest";
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, hostId: playerSessionId(), name: gameName, playerLimit }),
    });
    const data = await response.json() as { room?: HostedGame; error?: string };
    if (!response.ok || !data.room) {
      setNotice(data.error || "Unable to create a table.");
      return;
    }
    setGames((currentGames) => [data.room!, ...currentGames]);
    setNotice(`${data.room.name} is ready. Invite code: ${data.room.inviteCode}.`);
    setDialog(null);
    setName(host);
  }

  async function joinGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joinCode.length !== 6) {
      setNotice("Enter the six-character code from your host.");
      setDialog(null);
      return;
    }
    const code = joinCode.toUpperCase();
    const playerName = name.trim() || "Guest player";
    const response = await fetch(`/api/rooms/${code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerSessionId(), playerName }),
    });
    const data = await response.json() as { room?: HostedGame; error?: string };
    if (!response.ok || !data.room) {
      setNotice(data.error || "Unable to join this table.");
    } else {
      setGames((currentGames) => currentGames.map((game) => game.id === data.room!.id ? data.room! : game));
      setName(playerName);
      setNotice(`You joined ${data.room.name}.`);
    }
    setDialog(null);
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <button className="menu-button" aria-label="Open menu"><span /><span /><span /></button>
        <a className="pixel-logo" href="#">FAIRWAY<span>_</span></a>
        <p className="logo-tag">CARD GOLF ONLINE</p>
        <div className="top-actions"><button onClick={() => setDialog("join")}>JOIN CODE</button><button className="expand" aria-label="Fullscreen">⛶</button></div>
      </header>

      <div className="app-grid">
        <section className="games-panel">
          <div className="panel-bar"><span className="card-mark">♠</span> <h1>OPEN TABLES</h1>{games.length > 0 && <button className="new-game-button" onClick={() => setDialog("host")}>CREATE GAME</button>}</div>
          {games.length === 0 ? <div className="empty-state">
            <div className="table-preview" aria-hidden="true">
              <span className="seat north">WAITING</span><span className="seat east">WAITING</span><span className="seat south">YOU</span><span className="seat west">WAITING</span>
              <div className="deck-pile"><i>?</i><i>?</i></div><div className="discard-card">K<small>♣</small></div>
              <div className="hand-preview"><i>?</i><i>?</i><i>A</i><i>3</i></div>
            </div>
            <h2>THE TABLE IS OPEN.</h2>
            <p>Start a private table, then send the code to your group.</p>
            <button className="inline-create" onClick={() => setDialog("host")}>+ CREATE GAME</button>
          </div> : <div className="games-grid">
            {games.map((game) => <article className="game-square" key={game.id}>
              <Link href={`/game/${game.inviteCode}`} className="game-square-link">
              <div className="game-card-top"><span>OPEN TABLE</span><span className="status-dot" /></div>
              <div className="game-card-main"><h2>{game.name}</h2><p>HOSTED BY</p><h3>{game.host}</h3></div>
              <div className="game-card-info"><span><b>{game.players.length} / {game.playerLimit}</b> PLAYERS</span><span><b>{game.inviteCode}</b> INVITE CODE</span></div>
              </Link>
            </article>)}
          </div>}
        </section>

        <aside className="side-panel">
          <section className="players-list"><div className="panel-bar compact"><span>◉</span><h2>PLAYERS</h2></div><div className="player-card"><div className="avatar">G</div><div><strong>{name || "GUEST PLAYER"}</strong><small>YOU · IN THE CLUBHOUSE</small></div></div><div className="empty-player"><span>+</span> WAITING FOR A TABLE</div><div className="empty-player"><span>+</span> WAITING FOR A TABLE</div><div className="empty-player"><span>+</span> WAITING FOR A TABLE</div></section>
          <section className="game-notes"><div className="panel-bar compact"><span>?</span><h2>HOW TO PLAY</h2></div><p>Four cards. Nine holes. Lowest score wins.</p><a className="rules-link" href="/instructions">VIEW INSTRUCTIONS <b>→</b></a></section>
        </aside>
      </div>
      {notice && <p className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></p>}

      {dialog === "host" && <div className="modal-backdrop" role="presentation"><form className="game-modal" onSubmit={hostGame}><button type="button" className="close" onClick={() => setDialog(null)}>×</button><p>NEW TABLE</p><h2>HOST A GAME</h2><label>YOUR NAME<input autoFocus value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Guest player" /></label><label>TABLE NAME<input value={gameName} maxLength={30} onChange={(event) => setGameName(event.target.value)} placeholder="Friday Scramble" /></label><label>PLAYER LIMIT <output>{playerLimit}</output><input className="range" type="range" min="2" max="12" value={playerLimit} onChange={(event) => setPlayerLimit(Number(event.target.value))} /><small>{playerLimit > 6 ? "TWO DECKS WILL BE USED" : "ONE DECK WILL BE USED"}</small></label><button className="modal-submit" type="submit">CREATE TABLE →</button></form></div>}
      {dialog === "join" && <div className="modal-backdrop" role="presentation"><form className="game-modal" onSubmit={joinGame}><button type="button" className="close" onClick={() => setDialog(null)}>×</button><p>PRIVATE TABLE</p><h2>JOIN A GAME</h2><label>YOUR NAME<input autoFocus value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Guest player" /></label><label>ROOM CODE<input className="room-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="FAIRWY" /></label><small>ASK YOUR HOST FOR THE SIX-CHARACTER CODE.</small><button className="modal-submit" type="submit">JOIN TABLE →</button></form></div>}
    </main>
  );
}

function playerSessionId(): string {
  const storageKey = "fairway-four-player-id";
  const savedId = window.localStorage.getItem(storageKey);
  if (savedId) return savedId;
  const playerId = crypto.randomUUID();
  window.localStorage.setItem(storageKey, playerId);
  return playerId;
}
