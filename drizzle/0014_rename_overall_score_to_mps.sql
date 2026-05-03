-- Rename the composite manager metric from "overall_score" to "mps"
-- (Manager Process Score). MPS is the process/algorithm quality score,
-- distinct from MOS (Manager Outcome Score).
--
-- Idempotent: re-running is a no-op once all rows are renamed.

UPDATE "manager_metrics"
SET "metric" = 'mps'
WHERE "metric" = 'overall_score';
