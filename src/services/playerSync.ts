import { Sleeper } from "@/lib/sleeper";
import { getDb, schema } from "@/db";
import { sql, isNull } from "drizzle-orm";

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const STALENESS_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if the players table needs refreshing.
 */
async function isStale(): Promise<boolean> {
  const db = getDb();
  const result = await db
    .select({ latest: sql<string>`max(${schema.players.updatedAt})` })
    .from(schema.players);

  if (!result[0]?.latest) return true; // No players yet
  const lastUpdate = new Date(result[0].latest);
  return Date.now() - lastUpdate.getTime() > STALENESS_MS;
}

/**
 * Sync all fantasy-relevant NFL players from Sleeper.
 * Skips if data is less than 24 hours old.
 * Returns the number of players synced, or 0 if skipped.
 */
export async function syncPlayers(force = false): Promise<number> {
  if (!force && !(await isStale())) {
    return 0;
  }

  const db = getDb();
  const playerMap = await Sleeper.getPlayers();

  let count = 0;
  const entries = Object.values(playerMap);

  // Batch in chunks of 50 to avoid overwhelming Neon
  const BATCH_SIZE = 50;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const values = batch
      .filter((p) => p.position && FANTASY_POSITIONS.has(p.position))
      .map((p) => ({
        id: p.player_id,
        // Sleeper occasionally returns gsis_id with stray whitespace (the 2019
        // draft cohort all had a leading space) — normalize so joins onto the
        // nflverse-sourced nfl_weekly_roster_status table actually match.
        gsisId: p.gsis_id?.trim() || null,
        name: p.full_name || `${p.first_name} ${p.last_name}`,
        firstName: p.first_name,
        lastName: p.last_name,
        position: p.position,
        team: p.team,
        age: p.age,
        status: p.status,
        injuryStatus: p.injury_status,
        yearsExp: p.years_exp,
        updatedAt: new Date(),
      }));

    if (values.length === 0) continue;

    await db
      .insert(schema.players)
      .values(values)
      .onConflictDoUpdate({
        target: schema.players.id,
        set: {
          name: sql`excluded.name`,
          gsisId: sql`excluded.gsis_id`,
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          age: sql`excluded.age`,
          status: sql`excluded.status`,
          injuryStatus: sql`excluded.injury_status`,
          yearsExp: sql`excluded.years_exp`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    count += values.length;
  }

  // Backfill missing gsisIds from nflverse data via name matching
  await backfillGsisIds();

  return count;
}

/**
 * Backfill missing gsisIds by matching player names against nflWeeklyRosterStatus.
 * Uses exact name match, disambiguating by position when multiple candidates exist.
 */
async function backfillGsisIds(): Promise<number> {
  const db = getDb();

  // Get players missing gsisId
  const missing = await db
    .select({
      id: schema.players.id,
      name: schema.players.name,
      position: schema.players.position,
    })
    .from(schema.players)
    .where(isNull(schema.players.gsisId));

  if (missing.length === 0) return 0;

  // Get distinct (gsisId, name, position) from nflverse roster status
  const rosterEntries = await db
    .selectDistinct({
      gsisId: schema.nflWeeklyRosterStatus.gsisId,
      name: schema.nflWeeklyRosterStatus.playerName,
      position: schema.nflWeeklyRosterStatus.position,
    })
    .from(schema.nflWeeklyRosterStatus);

  // Build lookup: lowercase name → [{gsisId, position}]
  const nameMap = new Map<string, Array<{ gsisId: string; position: string | null }>>();
  for (const r of rosterEntries) {
    if (!r.name) continue;
    const key = r.name.toLowerCase().trim();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push({ gsisId: r.gsisId, position: r.position });
  }

  // Match players
  const updates: Array<{ id: string; gsisId: string }> = [];
  for (const p of missing) {
    const key = p.name.toLowerCase().trim();
    const candidates = nameMap.get(key);
    if (!candidates || candidates.length === 0) continue;

    const uniqueGsis = [...new Set(candidates.map((c) => c.gsisId))];
    if (uniqueGsis.length === 1) {
      updates.push({ id: p.id, gsisId: uniqueGsis[0] });
    } else {
      // Disambiguate by position
      const posMatch = candidates.filter((c) => c.position === p.position);
      const posGsis = [...new Set(posMatch.map((c) => c.gsisId))];
      if (posGsis.length === 1) {
        updates.push({ id: p.id, gsisId: posGsis[0] });
      }
    }
  }

  console.log(`[backfillGsisIds] Matched ${updates.length} of ${missing.length} players missing gsisId`);

  // Batch update
  const BATCH_SIZE = 50;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    try {
      for (const u of batch) {
        await db
          .update(schema.players)
          .set({ gsisId: u.gsisId })
          .where(sql`${schema.players.id} = ${u.id}`);
      }
    } catch (err) {
      console.error(`[backfillGsisIds] Error updating batch starting at index ${i}:`, err);
    }
  }

  return updates.length;
}
