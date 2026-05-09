/**
 * Backfill `drafts.slot_to_roster_id` for every row where it's null.
 *
 * Why: `Sleeper.getDrafts()` calls `/league/{id}/drafts`, which returns
 * summary entries that omit `slot_to_roster_id`. The list-endpoint bug has
 * been writing NULL into the column for the lifetime of the schema. The
 * graph-route remap that converts `draft_selected` events from "drafter"
 * to "true original owner" silently no-ops without it, breaking lineage
 * tracer pick→player resolution for traded picks (#173).
 *
 * The sibling fix in `src/services/sync.ts` swaps to the per-draft endpoint
 * so future syncs populate the column naturally; this script repairs
 * existing rows so we don't have to wait for natural re-sync.
 *
 * Idempotent: only updates rows where `slot_to_roster_id IS NULL`. Re-runs
 * are no-ops.
 *
 * Usage:
 *   # Dry-run (default; prints what would change without writing)
 *   npm run backfill:slot-to-roster-id
 *
 *   # Apply against the database `.env.local`/`getDb()` resolves to.
 *   # Off-Vercel that's `DATABASE_URL_DEV` if set, else `DATABASE_URL`.
 *   npm run backfill:slot-to-roster-id -- --apply
 *
 * Targeting prod: temporarily unset `DATABASE_URL_DEV` in `.env.local` (or
 * pass an explicit `DATABASE_URL` env var) before running with `--apply`.
 */

import { getDb, schema } from "@/db";
import { Sleeper } from "@/lib/sleeper";
import { eq } from "drizzle-orm";

interface RunStats {
  total: number;
  alreadyPopulated: number;
  fetched: number;
  updated: number;
  failed: number;
  skippedNoMap: number;
}

export async function run(
  argv: string[],
  deps: {
    db?: ReturnType<typeof getDb>;
    fetchDraft?: (id: string) => Promise<{ slot_to_roster_id?: Record<string, number> }>;
    log?: (msg: string) => void;
  } = {}
): Promise<RunStats> {
  const apply = argv.includes("--apply");
  const help = argv.includes("--help") || argv.includes("-h");
  const log = deps.log ?? ((msg: string) => console.log(msg));

  if (help) {
    log(
      "Usage: backfill-slot-to-roster-id [--apply]\n" +
        "  --apply  Persist updates. Without it, prints planned changes only."
    );
    return {
      total: 0,
      alreadyPopulated: 0,
      fetched: 0,
      updated: 0,
      failed: 0,
      skippedNoMap: 0,
    };
  }

  const db = deps.db ?? getDb();
  const fetchDraft = deps.fetchDraft ?? Sleeper.getDraft;

  const allDrafts = await db
    .select({
      id: schema.drafts.id,
      season: schema.drafts.season,
      status: schema.drafts.status,
      slotToRosterId: schema.drafts.slotToRosterId,
    })
    .from(schema.drafts);

  const targets = allDrafts.filter((d) => d.slotToRosterId == null);

  const stats: RunStats = {
    total: allDrafts.length,
    alreadyPopulated: allDrafts.length - targets.length,
    fetched: 0,
    updated: 0,
    failed: 0,
    skippedNoMap: 0,
  };

  log(`Found ${allDrafts.length} drafts in DB.`);
  log(
    `  ${stats.alreadyPopulated} already populated.\n` +
      `  ${targets.length} to backfill.${apply ? "" : " (dry-run; pass --apply to persist)"}`
  );

  for (const draft of targets) {
    try {
      const sleeperDraft = await fetchDraft(draft.id);
      stats.fetched++;
      const slotMap = sleeperDraft.slot_to_roster_id ?? null;
      if (!slotMap) {
        // Pre-draft drafts haven't had slots assigned yet. Expected for
        // upcoming-season rows; nothing to do.
        stats.skippedNoMap++;
        log(
          `  - draft ${draft.id} (${draft.season}, ${draft.status}): no slot_to_roster_id from API; skipping`
        );
        continue;
      }
      if (apply) {
        await db
          .update(schema.drafts)
          .set({ slotToRosterId: slotMap })
          .where(eq(schema.drafts.id, draft.id));
      }
      stats.updated++;
      log(
        `  ${apply ? "+" : "."} draft ${draft.id} (${draft.season}): ${
          Object.keys(slotMap).length
        } slots`
      );
    } catch (err) {
      stats.failed++;
      log(
        `  ! draft ${draft.id} (${draft.season}): fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  log(
    `\nDone. fetched=${stats.fetched} updated=${stats.updated} skipped=${stats.skippedNoMap} failed=${stats.failed}` +
      (apply ? "" : " (dry-run)")
  );

  return stats;
}

// CLI entry — only executes when invoked directly via tsx / node.
if (require.main === module) {
  run(process.argv.slice(2)).then(
    (stats) => process.exit(stats.failed > 0 ? 1 : 0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
