import type { OneBotGroupInfo } from "../onebot/types.js";

let cachedGroups: OneBotGroupInfo[] = [];

export function setCachedGroups(groups: OneBotGroupInfo[]): void {
  cachedGroups = [...groups];
}

export function getCachedGroups(): OneBotGroupInfo[] {
  return cachedGroups;
}
