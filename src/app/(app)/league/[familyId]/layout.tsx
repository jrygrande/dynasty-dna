import { ensureLeagueFresh } from "@/lib/freshness";

/**
 * Server-component layout for every page under `/league/[familyId]/...`.
 *
 * Runs the lazy-on-visit freshness gate (#150) before any descendant page
 * renders. Behavior:
 *
 *   - Fresh (within window) -> renders children immediately, no sync.
 *   - Stale (past window)   -> blocks on a watermark-incremental sync, then
 *                              renders children with fresh data.
 *   - Cold (never synced)   -> renders a minimal placeholder with the
 *                              `jobId`. The DNA-themed loading screen lives
 *                              behind #151 (Wave 3). Until it ships, the
 *                              placeholder gives the cold-visitor a stable
 *                              "we're syncing" surface; #151 will swap this
 *                              for the real chunked-progress UI.
 *
 * The gate is single-pass per request — `ensureLeagueFresh` short-circuits
 * cheaply when data is fresh, and concurrency is enforced by the existing
 * `syncJobs` lock.
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
    return (
      <ColdSyncPlaceholder familyId={result.familyId} jobId={result.jobId} />
    );
  }

  return <>{children}</>;
}

/**
 * Minimal placeholder shown to first-time visitors while the cold sync is
 * being kicked off. #151 (cold-start chunked executor) will replace this
 * with a polling, progress-bar UI keyed off the same `jobId`.
 *
 * Until #151 lands, we render a stable, accessible "Preparing your league"
 * surface. The `data-job-id` attribute is left for #151 to wire up.
 */
function ColdSyncPlaceholder({
  familyId,
  jobId,
}: {
  familyId: string | null;
  jobId?: string;
}) {
  return (
    <div
      className="min-h-[60vh] flex items-center justify-center"
      data-family-id={familyId ?? ""}
      data-job-id={jobId ?? ""}
    >
      <div className="text-center max-w-md px-6">
        <div className="animate-pulse text-foreground text-lg font-medium mb-2">
          Preparing your league
        </div>
        <p className="text-sm text-muted-foreground">
          We&apos;re pulling in the latest data from Sleeper. This usually
          takes 10-30 seconds for new leagues.
        </p>
      </div>
    </div>
  );
}
