import { Sleeper } from "@/lib/sleeper";
import { getDb, schema } from "@/db";
import { sql } from "drizzle-orm";

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
        gsisId: p.gsis_id,
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

  return count;
}
