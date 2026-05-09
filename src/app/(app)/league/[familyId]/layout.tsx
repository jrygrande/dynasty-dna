import { ensureLeagueFresh } from "@/lib/freshness";
import { ColdSyncLoadingScreen } from "@/components/loading/ColdSyncLoadingScreen";

/**
 * Server-component layout for every page under `/league/[familyId]/...`.
 *
 * Runs the lazy-on-visit freshness gate (#150) before any descendant page
 * renders. Behavior:
 *
 *   - Fresh (within window) -> renders children immediately, no sync.
 *   - Stale (past window)   -> blocks on a watermark-incremental sync, then
 *                              renders children with fresh data.
 *   - Cold (never synced)   -> renders the DNA-themed cold-sync loading
 *                              screen (#151), which polls
 *                              `/api/sync/jobs/[jobId]/tick` every 1s and
 *                              navigates to the dashboard when the chunked
 *                              executor reports `completed`.
 *
 * The gate is single-pass per request — `ensureLeagueFresh` short-circuits
 * cheaply when data is fresh, and concurrency is enforced by the existing
 * `syncJobs` lock. When the same family is being indexed by another
 * visitor, `ensureLeagueFresh` returns the in-flight `jobId`, so both
 * tabs share one chunked run.
 */
export default async function LeagueFamilyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { familyId: string };
}) {
  const result = await ensureLeagueFresh(params.familyId);

  if (!result.ready) {
    // `result.familyId` is guaranteed when `ready === false` — the cold
    // path resolves the family before deciding to lazy-sync.
    return (
      <ColdSyncLoadingScreen
        familyId={result.familyId ?? params.familyId}
        initialJobId={result.jobId}
      />
    );
  }

  return <>{children}</>;
}
