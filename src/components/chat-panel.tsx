"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { ChatBroadcast, ChatChannel, ChatMessage } from "../lib/chat";

type ChatPanelProps = {
  channel: ChatChannel;
  inviteCode?: string;
  playerId: string;
  playerName: string;
  className?: string;
};

export default function ChatPanel({ channel, inviteCode, playerId, playerName, className = "" }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const normalizedInviteCode = inviteCode?.toUpperCase();

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message].slice(-100));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const endpoint = channel === "lobby" ? "/api/chat/lobby" : `/api/rooms/${normalizedInviteCode}/chat?playerId=${encodeURIComponent(playerId)}`;
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() as { messages?: ChatMessage[]; error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) return setError(data.error || "Unable to load chat.");
        setMessages(data.messages || []);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Unable to load chat.");
      });
    return () => controller.abort();
  }, [channel, normalizedInviteCode, playerId]);

  useEffect(() => {
    if (!playerId) return;
    const socket = io({ path: "/socket.io" });
    socket.on("connect", () => {
      socket.emit("identify", { playerId, name: playerName });
      if (channel === "lobby") socket.emit("watch:lobby");
      else if (normalizedInviteCode) socket.emit("watch:room", normalizedInviteCode);
    });
    socket.on("chat:message", (event: ChatBroadcast) => {
      if (event.channel !== channel) return;
      if (channel === "room" && event.inviteCode !== normalizedInviteCode) return;
      addMessage(event.message);
    });
    return () => { socket.disconnect(); };
  }, [addMessage, channel, normalizedInviteCode, playerId, playerName]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const endpoint = channel === "lobby" ? "/api/chat/lobby" : `/api/rooms/${normalizedInviteCode}/chat`;
      const payload = channel === "lobby" ? { playerId, playerName, body } : { playerId, body };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !data.message) return setError(data.error || "Unable to send this message.");
      addMessage(data.message);
      setDraft("");
    } catch {
      setError("Unable to send this message.");
    } finally {
      setSending(false);
    }
  }

  return <section className={`chat-panel ${className}`} aria-label={channel === "lobby" ? "Clubhouse chat" : "Table chat"}>
    <div className="panel-bar compact"><span>◌</span><h2>{channel === "lobby" ? "CLUBHOUSE CHAT" : "TABLE CHAT"}</h2></div>
    <div className="chat-messages" ref={listRef} aria-live="polite">
      {messages.length === 0 && <p className="chat-empty">NO MESSAGES YET. SAY HELLO.</p>}
      {messages.map((message) => <article className={message.playerId === playerId ? "is-you" : ""} key={message.id}><header><b>{message.playerName}{message.playerId === playerId ? " (YOU)" : ""}</b><time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></header><p>{message.body}</p></article>)}
    </div>
    <form className="chat-compose" onSubmit={sendMessage}><input aria-label="Chat message" value={draft} maxLength={280} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message…" /><button disabled={!draft.trim() || sending} type="submit">SEND</button></form>
    {error && <p className="chat-error" role="status">{error}</p>}
  </section>;
}
