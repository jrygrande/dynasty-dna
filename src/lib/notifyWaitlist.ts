import { sendNotify } from "@/lib/email";

interface PendingRow {
  id: string;
  email: string;
  leagueId: string;
}

export interface NotifyDb {
  getMembers: (familyId: string) => Promise<string[]>;
  getPending: (leagueIds: string[]) => Promise<PendingRow[]>;
  getLeagueName: (leagueId: string) => Promise<string | null>;
  markNotified: (id: string) => Promise<void>;
}

export interface NotifyOptions {
  familyId: string;
  db: NotifyDb;
  // Injected for testability — defaults to real Resend send and a real
  // setTimeout-based sleep.
  send?: (params: {
    to: string;
    leagueName: string;
    familyId: string;
  }) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  perRowDelayMs?: number;
}

export interface NotifySummary {
  notified: number;
  skipped: number;
  unsent: string[];
}

const BACKOFF_MS = [1000, 2000, 4000, 8000];

function isRateLimitError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes("rate") ||
    msg.includes("429") ||
    msg.includes("too many")
  );
}

function isDailyCapError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes("daily") &&
    (msg.includes("cap") || msg.includes("limit") || msg.includes("quota"))
  );
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

export async function notifyWaitlist({
  familyId,
  db,
  send,
  sleep,
  perRowDelayMs = 100,
}: NotifyOptions): Promise<NotifySummary> {
  const doSend =
    send ??
    (async (p) => {
      return sendNotify({
        to: p.to,
        leagueName: p.leagueName,
        familyId: p.familyId,
      });
    });
  const doSleep =
    sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const memberLeagueIds = await db.getMembers(familyId);
  if (memberLeagueIds.length === 0) {
    return { notified: 0, skipped: 0, unsent: [] };
  }
  const pending = await db.getPending(memberLeagueIds);
  if (pending.length === 0) {
    return { notified: 0, skipped: 0, unsent: [] };
  }

  // Cache league name resolution per leagueId — multiple rows often share one
  // leagueId.
  const nameCache = new Map<string, string>();
  async function resolveName(leagueId: string): Promise<string> {
    if (nameCache.has(leagueId)) return nameCache.get(leagueId) as string;
    const name = (await db.getLeagueName(leagueId)) ?? leagueId;
    nameCache.set(leagueId, name);
    return name;
  }

  let notified = 0;
  const skipped = 0;
  const unsent: string[] = [];

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const leagueName = await resolveName(row.leagueId);

    let sent = false;
    let dailyCapHit = false;
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        await doSend({
          to: row.email,
          leagueName,
          familyId,
        });
        sent = true;
        break;
      } catch (err) {
        if (isDailyCapError(err)) {
          dailyCapHit = true;
          break;
        }
        if (isRateLimitError(err) && attempt < BACKOFF_MS.length) {
          await doSleep(BACKOFF_MS[attempt]);
          continue;
        }
        // Non-retryable error: log and move on.
        console.error(
          `[notify-waitlist] send failed for row ${row.id}:`,
          errorMessage(err)
        );
        break;
      }
    }

    if (sent) {
      try {
        await db.markNotified(row.id);
        notified++;
      } catch (err) {
        console.error(
          `[notify-waitlist] mark-notified failed for row ${row.id}:`,
          errorMessage(err)
        );
        unsent.push(row.id);
      }
    } else {
      unsent.push(row.id);
    }

    if (dailyCapHit) {
      // Log all remaining IDs as unsent and exit cleanly.
      for (let j = i + 1; j < pending.length; j++) {
        unsent.push(pending[j].id);
      }
      console.warn(
        "[notify-waitlist] daily cap hit — exiting cleanly. Re-run tomorrow."
      );
      break;
    }

    if (i < pending.length - 1) {
      await doSleep(perRowDelayMs);
    }
  }

  return { notified, skipped, unsent };
}
