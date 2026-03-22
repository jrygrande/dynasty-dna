-- Deduplicate league_families before adding unique constraint on root_league_id.
-- For each root_league_id with multiple families, keep the oldest (earliest created_at)
-- and reassign members from duplicates to the keeper.

-- Step 1: Reassign league_family_members from duplicate families to the keeper
WITH keepers AS (
  SELECT DISTINCT ON (root_league_id)
    id, root_league_id
  FROM league_families
  ORDER BY root_league_id, created_at ASC
),
duplicates AS (
  SELECT lf.id AS dup_id, k.id AS keeper_id
  FROM league_families lf
  JOIN keepers k ON k.root_league_id = lf.root_league_id
  WHERE lf.id != k.id
)
UPDATE league_family_members lfm
SET family_id = d.keeper_id
FROM duplicates d
WHERE lfm.family_id = d.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM league_family_members existing
    WHERE existing.family_id = d.keeper_id
      AND existing.league_id = lfm.league_id
  );

-- Step 2: Delete orphaned members that couldn't be reassigned (duplicates)
WITH keepers AS (
  SELECT DISTINCT ON (root_league_id)
    id, root_league_id
  FROM league_families
  ORDER BY root_league_id, created_at ASC
)
DELETE FROM league_family_members lfm
WHERE lfm.family_id NOT IN (SELECT id FROM keepers)
  AND EXISTS (
    SELECT 1 FROM league_families lf
    WHERE lf.id = lfm.family_id
      AND lf.root_league_id IN (
        SELECT root_league_id FROM league_families
        GROUP BY root_league_id HAVING count(*) > 1
      )
  );

-- Step 3: Delete duplicate family rows
WITH keepers AS (
  SELECT DISTINCT ON (root_league_id)
    id, root_league_id
  FROM league_families
  ORDER BY root_league_id, created_at ASC
)
DELETE FROM league_families
WHERE id NOT IN (SELECT id FROM keepers)
  AND root_league_id IN (
    SELECT root_league_id FROM league_families
    GROUP BY root_league_id HAVING count(*) > 1
  );

-- Step 4: Add unique index
CREATE UNIQUE INDEX IF NOT EXISTS "league_families_root_league_id_unique" ON "league_families" ("root_league_id");

-- Step 5: Add index on sync_jobs for efficient lock checks
CREATE INDEX IF NOT EXISTS "sync_jobs_ref_status_idx" ON "sync_jobs" ("ref", "status");

-- Step 6: Create sync_watermarks table for incremental sync
CREATE TABLE IF NOT EXISTS "sync_watermarks" (
  "league_id" text NOT NULL,
  "data_type" text NOT NULL,
  "last_week" integer NOT NULL DEFAULT 0,
  "last_synced_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sync_watermarks_pkey" PRIMARY KEY ("league_id", "data_type")
);
