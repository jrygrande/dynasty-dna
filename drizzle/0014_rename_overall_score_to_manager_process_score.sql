-- Rename the composite manager metric from "overall_score" to
-- "manager_process_score" (MPS). MPS is the process/algorithm quality
-- score, distinct from MOS (Manager Outcome Score) which is computed
-- in src/services/outcomeScore.ts and not stored in this column.
--
-- Long form keeps the metric value consistent with its siblings
-- (draft_score, trade_score, waiver_score, lineup_score) — each row
-- in this column reads as "<x>_score". UI surfaces still display "MPS".
--
-- Idempotent: re-running is a no-op once all rows are renamed.

UPDATE "manager_metrics"
SET "metric" = 'manager_process_score'
WHERE "metric" = 'overall_score';
