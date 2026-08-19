export type ChatChannel = "lobby" | "room";

export type ChatMessage = {
  id: string;
  channel: ChatChannel;
  inviteCode?: string;
  playerId: string;
  playerName: string;
  body: string;
  sentAt: number;
};

export type ChatBroadcast = {
  channel: ChatChannel;
  inviteCode?: string;
  message: ChatMessage;
};
