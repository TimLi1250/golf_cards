export type PlayerProfile = {
  id: string;
  name: string;
};

const playerIdKey = "fairway-four-player-id";
const playerNameKey = "fairway-four-player-name";

export function playerProfile(): PlayerProfile {
  const storage = browserStorage();
  if (!storage) return { id: "", name: "Guest" };
  let id = storage?.getItem(playerIdKey) || "";
  if (!id) {
    id = createPlayerId();
    storage?.setItem(playerIdKey, id);
  }
  return { id, name: cleanPlayerName(storage?.getItem(playerNameKey)) };
}

export function savePlayerName(value: string): string {
  const name = cleanPlayerName(value);
  browserStorage()?.setItem(playerNameKey, name);
  return name;
}

export async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") throw new Error("Clipboard is unavailable.");
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Clipboard is unavailable.");
}

function cleanPlayerName(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ").slice(0, 24) || "Guest";
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function createPlayerId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      return `player-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
  } catch {
    // Raw HTTP pages can expose Web Crypto without permitting randomUUID().
  }
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
