import { getDb, schema } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { getFantasyCalcValues } from "@/lib/fantasycalc";
import { recordSyncBreadcrumb } from "@/lib/observability/syncBreadcrumb";
import type { SyncTrigger } from "@/lib/observability/syncBreadcrumb";

const STALENESS_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface FantasyCalcConfig {
  isSuperFlex: boolean;
  ppr: number;
  numTeams: number;
  numQbs: number;
}

interface FantasyCalcSyncOpts {
  force?: boolean;
  trigger?: SyncTrigger;
}

/**
 * Sync FantasyCalc dynasty trade values for an explicit config combo.
 * Used by the cron job and the one-shot post-migration backfill — neither
 * has a leagueId in hand. Upserts by (playerId, isSuperFlex, ppr, numTeams,
 * numQbs). Skips if data for this config is less than 12 hours old.
 *
 * Returns the fetchedAt timestamp, or null if no data.
 */
export async function syncFantasyCalcValuesForConfig(
  config: FantasyCalcConfig,
  opts?: FantasyCalcSyncOpts,
): Promise<Date | null> {
  const { isSuperFlex, ppr, numTeams, numQbs } = config;
  const db = getDb();
  const trigger = opts?.trigger ?? "manual";
  const scope = `sf=${isSuperFlex}|ppr=${ppr}|teams=${numTeams}|qbs=${numQbs}`;
  const startedAt = Date.now();
  let apiCalls = 0;
  let outcome: "success" | "failed" = "success";
  let errorMessage: string | undefined;

  try {
    return await runSyncFantasyCalcForConfig(config, opts, () => {
      apiCalls += 1;
    });
  } catch (err) {
    outcome = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    recordSyncBreadcrumb({
      source: "fantasycalc",
      trigger,
      scope,
      outcome,
      durationMs: Date.now() - startedAt,
      apiCalls,
      error: errorMessage,
    });
  }
}

async function runSyncFantasyCalcForConfig(
  config: FantasyCalcConfig,
  opts: FantasyCalcSyncOpts | undefined,
  onApiCall: () => void,
): Promise<Date | null> {
  const { isSuperFlex, ppr, numTeams, numQbs } = config;
  const db = getDb();

  // Staleness check per full config key (isSuperFlex, ppr, numTeams, numQbs)
  const [latestRow] = await db
    .select({
      latest: sql<string>`max(${schema.fantasyCalcValues.fetchedAt})`,
    })
    .from(schema.fantasyCalcValues)
    .where(
      and(
        eq(schema.fantasyCalcValues.isSuperFlex, isSuperFlex),
        eq(schema.fantasyCalcValues.ppr, ppr),
        eq(schema.fantasyCalcValues.numTeams, numTeams),
        eq(schema.fantasyCalcValues.numQbs, numQbs),
      ),
    );

  if (latestRow?.latest && !opts?.force) {
    const lastFetch = new Date(latestRow.latest);
    if (Date.now() - lastFetch.getTime() < STALENESS_MS) {
      return lastFetch;
    }
  }

  // Fetch from FantasyCalc API
  onApiCall();
  const values = await getFantasyCalcValues({
    isDynasty: true,
    numQbs,
    numTeams,
    ppr,
  });

  // Filter to entries with a sleeper ID
  const withSleeperId = values.filter((v) => v.player.sleeperId);
  const pickEntries = values.filter((v) => v.player.position === "PICK");

  if (withSleeperId.length === 0) {
    console.warn("[fantasyCalcSync] No entries with sleeperId found");
    return null;
  }

  const fetchedAt = new Date();

  // Batch upsert players
  const BATCH_SIZE = 50;
  for (let i = 0; i < withSleeperId.length; i += BATCH_SIZE) {
    const batch = withSleeperId.slice(i, i + BATCH_SIZE);
    await db
      .insert(schema.fantasyCalcValues)
      .values(
        batch.map((v) => ({
          playerId: v.player.sleeperId!,
          isSuperFlex,
          ppr,
          numTeams,
          numQbs,
          playerName: v.player.name,
          value: v.value,
          rank: v.overallRank,
          positionRank: v.positionRank,
          position: v.player.position,
          team: v.player.maybeTeam,
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.fantasyCalcValues.playerId,
          schema.fantasyCalcValues.isSuperFlex,
          schema.fantasyCalcValues.ppr,
          schema.fantasyCalcValues.numTeams,
          schema.fantasyCalcValues.numQbs,
        ],
        set: {
          playerName: sql`excluded.player_name`,
          value: sql`excluded.value`,
          rank: sql`excluded.rank`,
          positionRank: sql`excluded.position_rank`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  // Batch upsert PICK entries (use name as ID since no sleeperId)
  for (let i = 0; i < pickEntries.length; i += BATCH_SIZE) {
    const batch = pickEntries.slice(i, i + BATCH_SIZE);
    await db
      .insert(schema.fantasyCalcValues)
      .values(
        batch.map((v) => ({
          playerId: `PICK_${v.player.name.replace(/\s+/g, "_")}`,
          isSuperFlex,
          ppr,
          numTeams,
          numQbs,
          playerName: v.player.name,
          value: v.value,
          rank: v.overallRank,
          positionRank: v.positionRank,
          position: "PICK",
          team: null,
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.fantasyCalcValues.playerId,
          schema.fantasyCalcValues.isSuperFlex,
          schema.fantasyCalcValues.ppr,
          schema.fantasyCalcValues.numTeams,
          schema.fantasyCalcValues.numQbs,
        ],
        set: {
          playerName: sql`excluded.player_name`,
          value: sql`excluded.value`,
          rank: sql`excluded.rank`,
          positionRank: sql`excluded.position_rank`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  console.log(
    `[fantasyCalcSync] Synced ${withSleeperId.length} players + ${pickEntries.length} picks (ppr=${ppr}, sf=${isSuperFlex}, teams=${numTeams}, qbs=${numQbs})`,
  );
  return fetchedAt;
}

/**
 * Sync FantasyCalc dynasty trade values for a league's settings.
 * Upserts by (playerId, isSuperFlex, ppr, numTeams, numQbs) — each format
 * gets its own row per player. Skips if data for this config is less than
 * 12 hours old.
 *
 * Returns the fetchedAt timestamp, or null if no data.
 */
export async function syncFantasyCalcValues(
  leagueId: string,
  opts?: FantasyCalcSyncOpts,
): Promise<Date | null> {
  const db = getDb();

  // Read league settings to determine scoring format
  const [league] = await db
    .select({
      scoringSettings: schema.leagues.scoringSettings,
      rosterPositions: schema.leagues.rosterPositions,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  if (!league) {
    console.warn(`[fantasyCalcSync] League ${leagueId} not found in DB`);
    return null;
  }

  // Extract PPR setting
  const scoring = league.scoringSettings as Record<string, number> | null;
  const ppr = scoring?.rec ?? 0.5;

  // Detect superflex: check for SUPER_FLEX in roster positions
  const rosterPositions = (league.rosterPositions as string[]) || [];
  const isSuperFlex = rosterPositions.includes("SUPER_FLEX");
  const numQbs = isSuperFlex ? 2 : 1;

  const numTeams = league.totalRosters || 12;

  return syncFantasyCalcValuesForConfig(
    { isSuperFlex, ppr, numTeams, numQbs },
    opts,
  );
}

/**
 * Returns the distinct (isSuperFlex, ppr, numTeams, numQbs) combos in use
 * across the `leagues` table. Cron jobs use this to refresh every active
 * format with one API call per combo (rather than one per league).
 */
export async function getDistinctFantasyCalcConfigs(): Promise<
  Array<{
    isSuperFlex: boolean;
    ppr: number;
    numTeams: number;
    numQbs: number;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      scoringSettings: schema.leagues.scoringSettings,
      rosterPositions: schema.leagues.rosterPositions,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues);

  const seen = new Set<string>();
  const combos: Array<{
    isSuperFlex: boolean;
    ppr: number;
    numTeams: number;
    numQbs: number;
  }> = [];

  for (const row of rows) {
    const scoring = row.scoringSettings as Record<string, number> | null;
    const ppr = scoring?.rec ?? 0.5;
    const rosterPositions = (row.rosterPositions as string[]) || [];
    const isSuperFlex = rosterPositions.includes("SUPER_FLEX");
    const numQbs = isSuperFlex ? 2 : 1;
    const numTeams = row.totalRosters || 12;

    const key = `${isSuperFlex}|${ppr}|${numTeams}|${numQbs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push({ isSuperFlex, ppr, numTeams, numQbs });
  }

  return combos;
}
