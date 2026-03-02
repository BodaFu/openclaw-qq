import type { OneBotClient } from "../onebot/client.js";

let activeClient: OneBotClient | null = null;

export function setActiveClient(client: OneBotClient | null): void {
  activeClient = client;
}

export function getActiveClient(): OneBotClient | null {
  return activeClient;
}
