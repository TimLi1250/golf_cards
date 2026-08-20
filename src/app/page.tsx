"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import ChatPanel from "../components/chat-panel";
import ClubhouseAudio from "../components/clubhouse-audio";
import { copyText, playerProfile, savePlayerName } from "../lib/player-session";

type Dialog = "host" | "join" | "rename" | null;

type HostedGame = {
  id: string;
  name: string;
  host: string;
  playerLimit: number;
  isPrivate: boolean;
  status: "lobby" | "playing" | "finished";
  inviteCode: string;
  hostPlayerId: string;
  players: { id: string; name: string }[];
};

type LobbyPlayer = {
  id: string;
  name: string;
  status: "clubhouse" | "game";
};

export default function Home() {
  const router = useRouter();
  const [profile] = useState(playerProfile);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState(profile.name);
  const [draftName, setDraftName] = useState("");
  const [playerId] = useState(profile.id);
  const [gameName, setGameName] = useState("");
  const [playerLimit, setPlayerLimit] = useState(4);
  const [isPrivate, setIsPrivate] = useState(false);
  const [privateCode, setPrivateCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinTarget, setJoinTarget] = useState<HostedGame>();
  const [notice, setNotice] = useState("");
  const [games, setGames] = useState<HostedGame[]>([]);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);

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
    if (!playerId) return;
    const socket = io({ path: "/socket.io" });
    const watchLobby = () => {
      socket.emit("identify", { playerId, name });
      socket.emit("watch:lobby");
    };
    socket.on("connect", watchLobby);
    socket.on("lobby:update", () => void loadRooms());
    socket.on("lobby:presence", (players: LobbyPlayer[]) => setLobbyPlayers(players));
    return () => { socket.disconnect(); };
  }, [loadRooms, name, playerId]);

  async function hostGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const host = draftName.trim() || "Guest";
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, hostId: playerId || playerProfile().id, name: gameName, playerLimit, isPrivate, inviteCode: isPrivate ? privateCode : undefined }),
      });
      const data = await readRoomResponse(response);
      const room = data.room;
      if (!response.ok || !room) {
        setNotice(data.error || "Unable to create a table.");
        return;
      }
      setGames((currentGames) => [room, ...currentGames]);
      setDialog(null);
      setName(host);
      savePlayerName(host);
      router.push(`/game/${room.inviteCode}`);
    } catch {
      setNotice("Unable to reach the table server. Please try again.");
    }
  }

  async function joinGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = joinTarget?.inviteCode || joinCode.toUpperCase();
    const needsCode = !joinTarget || joinTarget.isPrivate;
    if (needsCode && joinCode.length !== 6) {
      setNotice("Enter the six-character code from your host.");
      return;
    }
    const playerName = draftName.trim() || "Guest";
    try {
      const response = await fetch(`/api/rooms/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: playerId || playerProfile().id, playerName, accessCode: needsCode ? joinCode.toUpperCase() : undefined }),
      });
      const data = await readRoomResponse(response);
      const room = data.room;
      if (!response.ok || !room) {
        setNotice(data.error || "Unable to join this table.");
        return;
      } else {
        setGames((currentGames) => currentGames.map((game) => game.id === room.id ? room : game));
        setName(playerName);
        savePlayerName(playerName);
        setNotice(`You joined ${room.name}.`);
        setDialog(null);
        router.push(`/game/${room.inviteCode}`);
      }
    } catch {
      setNotice("Unable to reach the table server. Please try again.");
    }
  }

  async function deleteHostedGame(game: HostedGame) {
    if (!window.confirm(`Delete ${game.name}? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/rooms/${game.inviteCode}?playerId=${encodeURIComponent(playerId)}`, { method: "DELETE" });
      const data = await response.json() as { removed?: boolean; error?: string };
      if (!response.ok || !data.removed) return setNotice(data.error || "Only the host can delete this table.");
      setGames((currentGames) => currentGames.filter((currentGame) => currentGame.id !== game.id));
      setNotice("Table deleted.");
    } catch {
      setNotice("Unable to delete this table right now.");
    }
  }

  function renamePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setName(savePlayerName(draftName));
    setDialog(null);
  }

  function openNameDialog(nextDialog: Exclude<Dialog, null>) {
    setDraftName(name);
    setDialog(nextDialog);
  }

  function openHostDialog() {
    setDraftName(name);
    setIsPrivate(false);
    setPrivateCode("");
    setDialog("host");
  }

  function openJoinDialog(game?: HostedGame) {
    setDraftName(name);
    setJoinTarget(game);
    setJoinCode("");
    setDialog("join");
  }

  function togglePrivateTable(enabled: boolean) {
    setIsPrivate(enabled);
    if (enabled && !privateCode) setPrivateCode(createInviteCode());
  }

  async function copyInviteCode() {
    try {
      await copyText(privateCode);
      setNotice("Invite code copied.");
    } catch {
      setNotice(`Invite code: ${privateCode}`);
    }
  }

  const orderedLobbyPlayers = [...lobbyPlayers].sort((first, second) => Number(second.id === playerId) - Number(first.id === playerId));

  return (
    <main className="dashboard-shell">
      <header className="topbar header-cardbar">
        <a className="pixel-logo" href="#"><span className="golf-ball-mark" aria-hidden="true" />GOLF</a>
        <span className="header-tagline">FOUR CARD • ONLINE TABLES</span>
        <div className="top-actions"><ClubhouseAudio /><button className="join-code-button" onClick={() => openJoinDialog()}>JOIN CODE</button></div>
      </header>

      <div className="app-grid">
        <section className="games-panel">
          <div className="panel-bar"><span className="card-mark">♠</span> <h1>OPEN TABLES</h1>{games.length > 0 && <button className="new-game-button" onClick={openHostDialog}>CREATE GAME</button>}</div>
          {games.length === 0 ? <div className="empty-state">
            <div className="table-preview" aria-hidden="true">
              <span className="seat north">WAITING</span><span className="seat east">WAITING</span><span className="seat south">YOU</span><span className="seat west">WAITING</span>
              <div className="deck-pile"><i>?</i><i>?</i></div><div className="discard-card">K<small>♣</small></div>
              <div className="hand-preview"><i>?</i><i>?</i><i>A</i><i>3</i></div>
            </div>
            <h2>THE TABLE IS OPEN.</h2>
            <p>Start a private table, then send the code to your group.</p>
            <button className="inline-create" onClick={openHostDialog}>+ CREATE GAME</button>
          </div> : <div className="games-grid">
            {games.map((game) => <article className="game-square" key={game.id}>
              <button type="button" onClick={() => game.isPrivate ? openJoinDialog(game) : router.push(`/game/${game.inviteCode}`)} className="game-square-link">
              <div className="game-card-top"><span>{game.status === "playing" ? "IN PROGRESS" : game.isPrivate ? "PRIVATE TABLE" : "PUBLIC TABLE"}</span><span className={`status-dot ${game.status === "playing" ? "in-progress" : game.isPrivate ? "private" : ""}`} aria-label={game.status === "playing" ? "Game in progress" : game.isPrivate ? "Private table" : "Public table"} /></div>
              <div className="game-card-main"><h2>{game.name}</h2><p>HOSTED BY</p><h3>{game.host}</h3></div>
              <div className="game-card-info"><span><b>{game.players.length} / {game.playerLimit}</b> PLAYERS</span></div>
              </button>
              {game.hostPlayerId === playerId && <button type="button" className="new-game-button" style={{ margin: "0 11px 11px auto" }} onClick={() => void deleteHostedGame(game)}>DELETE TABLE</button>}
            </article>)}
          </div>}
        </section>

        <aside className="side-panel">
          <section className="players-list"><div className="panel-bar compact"><span>◉</span><h2>PLAYERS</h2></div>{orderedLobbyPlayers.map((player) => <div className="player-card" key={player.id}>{player.id === playerId ? <button className="avatar avatar-button" aria-label="Rename yourself" title="Rename yourself" onClick={() => openNameDialog("rename")}>{player.name.charAt(0).toUpperCase()}</button> : <div className="avatar">{player.name.charAt(0).toUpperCase()}</div>}<div><strong>{player.name}{player.id === playerId ? " (YOU)" : ""}</strong><small>{player.status === "game" ? "IN A GAME" : "IN THE CLUBHOUSE"}</small></div></div>)}{lobbyPlayers.length === 0 && <div className="empty-player"><span>+</span> CONNECTING PLAYERS…</div>}</section>
          <section className="game-notes"><div className="panel-bar compact"><span>?</span><h2>HOW TO PLAY</h2></div><p>Four cards. Nine holes. Lowest score wins.</p><a className="rules-link" href="/instructions">VIEW INSTRUCTIONS <b>→</b></a></section>
          <ChatPanel channel="lobby" playerId={playerId} playerName={name} />
        </aside>
      </div>
      <ChatPanel channel="lobby" playerId={playerId} playerName={name} className="mobile-lobby-chat" />
      <footer className="lobby-credits">Created by Tim Li and Able Liang, Music by William Noguera</footer>
      {notice && <p className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></p>}

      {dialog === "host" && <div className="modal-backdrop" role="presentation"><form className="game-modal" onSubmit={hostGame}><button type="button" className="close" onClick={() => setDialog(null)}>×</button><p>NEW TABLE</p><h2>HOST A GAME</h2><label>YOUR NAME<input autoFocus value={draftName} maxLength={24} onChange={(event) => setDraftName(event.target.value)} placeholder="Guest" /></label><label>TABLE NAME<input value={gameName} maxLength={30} onChange={(event) => setGameName(event.target.value)} placeholder="Friday Scramble" /></label><label className="privacy-toggle">PRIVATE TABLE<input type="checkbox" checked={isPrivate} onChange={(event) => togglePrivateTable(event.target.checked)} /><span>{isPrivate ? "ON" : "OFF"}</span></label>{isPrivate && <div className="invite-preview"><span>INVITE CODE</span><b>{privateCode}</b><button type="button" onClick={() => void copyInviteCode()}>COPY</button></div>}<label>PLAYER LIMIT <output>{playerLimit}</output><input className="range" type="range" min="2" max="12" value={playerLimit} onChange={(event) => setPlayerLimit(Number(event.target.value))} /><small>{playerLimit > 6 ? "TWO DECKS WILL BE USED" : "ONE DECK WILL BE USED"}</small></label><button className="modal-submit" type="submit">CREATE TABLE →</button></form></div>}
      {dialog === "join" && <div className="modal-backdrop" role="presentation"><form className="game-modal" onSubmit={joinGame}><button type="button" className="close" onClick={() => setDialog(null)}>×</button><p>{joinTarget?.isPrivate ? "PRIVATE TABLE" : "TABLE ENTRY"}</p><h2>{joinTarget ? `JOIN ${joinTarget.name}` : "JOIN A GAME"}</h2><label>YOUR NAME<input autoFocus value={draftName} maxLength={24} onChange={(event) => setDraftName(event.target.value)} placeholder="Guest" /></label>{(!joinTarget || joinTarget.isPrivate) && <label>ROOM CODE<input className="room-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="FAIRWY" /></label>}<small>{joinTarget?.isPrivate ? "ENTER THE PRIVATE TABLE INVITE CODE." : joinTarget ? "JOIN THIS PUBLIC TABLE." : "ASK YOUR HOST FOR THE SIX-CHARACTER CODE."}</small><button className="modal-submit" type="submit">JOIN TABLE →</button></form></div>}
      {dialog === "rename" && <div className="modal-backdrop" role="presentation"><form className="game-modal" onSubmit={renamePlayer}><button type="button" className="close" onClick={() => setDialog(null)}>×</button><p>PLAYER PROFILE</p><h2>RENAME YOURSELF</h2><label>DISPLAY NAME<input autoFocus value={draftName} maxLength={24} onChange={(event) => setDraftName(event.target.value)} placeholder="Guest" /></label><button className="modal-submit" type="submit">SAVE NAME →</button></form></div>}
    </main>
  );
}

async function readRoomResponse(response: Response): Promise<{ room?: HostedGame; error?: string }> {
  try {
    return await response.json() as { room?: HostedGame; error?: string };
  } catch {
    return {};
  }
}

function createInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  try {
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
      for (const byte of bytes) code += alphabet[byte % alphabet.length];
      return code;
    }
  } catch {
    // A readable fallback keeps private-table creation usable on raw HTTP pages.
  }
  for (let index = 0; index < 6; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
