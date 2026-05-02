"use client";

export const STORED_USERNAME_KEY = "dd_username";

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredUsername(): string | null {
  const v = safeStorage()?.getItem(STORED_USERNAME_KEY) ?? null;
  return v && v.trim() ? v : null;
}

export function setStoredUsername(username: string): void {
  const ls = safeStorage();
  if (!ls) return;
  ls.setItem(STORED_USERNAME_KEY, username);
  // StorageEvent is only fired in *other* tabs; dispatch manually so listeners
  // in this tab (e.g. PublicNav) see the change too.
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: STORED_USERNAME_KEY,
      newValue: username,
    })
  );
}

export function clearStoredUsername(): void {
  const ls = safeStorage();
  if (!ls) return;
  ls.removeItem(STORED_USERNAME_KEY);
  window.dispatchEvent(
    new StorageEvent("storage", { key: STORED_USERNAME_KEY, newValue: null })
  );
}
