import type { OneBotClient } from "../onebot/client.js";
import type { OneBotGroupMemberInfo, OneBotFriendInfo } from "../onebot/types.js";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type CacheEntry = {
  info: OneBotGroupMemberInfo;
  fetchedAt: number;
};

const groupMemberCache = new Map<string, CacheEntry>();

// Friend remark cache: userId → remark (populated once from getFriendList)
let friendCache: Map<string, string> | null = null;
let friendCacheFetchedAt = 0;
const FRIEND_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Stranger nickname cache: userId → nickname
const strangerCache = new Map<string, { name: string; fetchedAt: number }>();

/**
 * Invisible Unicode chars that QQ users may use as "blank" nicknames.
 */
const INVISIBLE_PATTERN = /^[\s\u200B\u200C\u200D\u2060\uFEFF\u3164\u00A0\u3000\u2800]*$/;

export function isEffectivelyEmpty(name: string | undefined | null): boolean {
  if (!name) return true;
  return INVISIBLE_PATTERN.test(name);
}

function pickVisible(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  return isEffectivelyEmpty(trimmed) ? undefined : trimmed;
}

export async function getGroupMemberInfo(
  client: OneBotClient,
  groupId: number,
  userId: number,
): Promise<OneBotGroupMemberInfo | null> {
  const key = `${groupId}:${userId}`;
  const cached = groupMemberCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.info;
  }

  try {
    const info = await client.getGroupMemberInfo(groupId, userId);
    groupMemberCache.set(key, { info, fetchedAt: Date.now() });
    return info;
  } catch {
    return cached?.info ?? null;
  }
}

export function resolveMemberDisplayName(info: OneBotGroupMemberInfo | null): string | undefined {
  if (!info) return undefined;
  return pickVisible(info.card) ?? pickVisible(info.nickname);
}

/**
 * Resolve a visible display name for a QQ user, trying multiple sources:
 * 1. Friend remark (备注名)
 * 2. Stranger info (get_stranger_info)
 * 3. Fallback to "QQ用户{id}"
 */
export async function resolveUserDisplayName(
  client: OneBotClient,
  userId: number,
  eventNickname?: string,
): Promise<string> {
  // 1. If event nickname is visible, use it
  const visible = pickVisible(eventNickname);
  if (visible) return visible;

  const uid = String(userId);

  // 2. Try friend remark cache
  const remark = await getFriendRemark(client, uid);
  if (remark) return remark;

  // 3. Try stranger info
  const strangerName = await getStrangerName(client, userId);
  if (strangerName) return strangerName;

  return `QQ用户${uid}`;
}

async function getFriendRemark(client: OneBotClient, userId: string): Promise<string | undefined> {
  if (!friendCache || Date.now() - friendCacheFetchedAt > FRIEND_CACHE_TTL_MS) {
    try {
      const list = await client.getFriendList();
      friendCache = new Map<string, string>();
      for (const f of list) {
        const remark = pickVisible(f.remark) ?? pickVisible(f.nickname);
        if (remark) friendCache.set(String(f.user_id), remark);
      }
      friendCacheFetchedAt = Date.now();
    } catch {
      // Friend list unavailable
    }
  }
  return friendCache?.get(userId);
}

async function getStrangerName(client: OneBotClient, userId: number): Promise<string | undefined> {
  const key = String(userId);
  const cached = strangerCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return pickVisible(cached.name) ? cached.name : undefined;
  }

  try {
    const info = await client.getStrangerInfo(userId);
    const name = pickVisible(info.nickname);
    strangerCache.set(key, { name: name ?? "", fetchedAt: Date.now() });
    return name;
  } catch {
    return undefined;
  }
}

export function clearMemberCache(): void {
  groupMemberCache.clear();
  friendCache = null;
  strangerCache.clear();
}
