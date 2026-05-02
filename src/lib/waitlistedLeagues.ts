"use client";

import { safeStorage } from "@/lib/storedUsername";

const PREFIX = "dd_waitlisted_leagues_";

function key(username: string): string {
  return `${PREFIX}${username.toLowerCase()}`;
}

export function getWaitlistedLeagues(username: string): string[] {
  const ls = safeStorage();
  if (!ls || !username) return [];
  const raw = ls.getItem(key(username));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    // Corrupt entry — ignore, treat as empty.
  }
  return [];
}

export function addWaitlistedLeague(username: string, leagueId: string): void {
  const ls = safeStorage();
  if (!ls || !username || !leagueId) return;
  const current = getWaitlistedLeagues(username);
  if (current.includes(leagueId)) return;
  current.push(leagueId);
  ls.setItem(key(username), JSON.stringify(current));
}
