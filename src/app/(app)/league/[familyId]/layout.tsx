import { Suspense } from "react";
import { ensureLeagueFresh } from "@/lib/freshness";
import { ColdSyncLoadingScreen } from "@/components/loading/ColdSyncLoadingScreen";
import LeagueFamilyLoading from "./loading";

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
 * Streaming contract (#177 follow-up): the layout itself MUST stay
 * synchronous and return immediately. The slow `await ensureLeagueFresh()`
 * lives inside `<FreshnessGate>`, which is wrapped in a `<Suspense>`
 * boundary so the helix fallback flushes in the first response chunk. If
 * the layout `await`ed at the top level, the server couldn't send any
 * bytes until the gate resolved — the browser would stay frozen on the
 * previous page for the full sync duration before the helix appeared.
 */
export default function LeagueFamilyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { familyId: string };
}) {
  return (
    <Suspense fallback={<LeagueFamilyLoading />}>
      <FreshnessGate familyId={params.familyId}>{children}</FreshnessGate>
    </Suspense>
  );
}

async function FreshnessGate({
  familyId,
  children,
}: {
  familyId: string;
  children: React.ReactNode;
}) {
  const result = await ensureLeagueFresh(familyId);

  if (!result.ready) {
    // `result.familyId` is guaranteed when `ready === false` — the cold
    // path resolves the family before deciding to lazy-sync.
    return (
      <ColdSyncLoadingScreen
        familyId={result.familyId ?? familyId}
        initialJobId={result.jobId}
      />
    );
  }

  return <>{children}</>;
}
