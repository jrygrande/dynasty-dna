import { DnaHelix3D } from "@/components/loading/DnaHelix3DDynamic";

/**
 * Route-level Suspense fallback for `/league/[familyId]/...` (#177, fix 2).
 *
 * The layout above (`layout.tsx`) awaits `ensureLeagueFresh()` server-side,
 * which in the stale path can run a multi-second sync before responding.
 * Without this file, Next.js renders no fallback during navigation — a
 * click on "Open" looks dead until the layout resolves. App Router uses
 * route-level `loading.tsx` as the automatic Suspense boundary, so the
 * helix flashes immediately while the server-side freshness gate runs.
 *
 * Scope: presentation only. No polling, no jobId, no fetching — that's
 * the cold-sync screen's job (rendered by the layout when `ready=false`).
 * Stale path renders the layout, which Suspense-falls-back to this file.
 *
 * Reduced motion is handled inside `DnaHelix` itself.
 */
export default function LeagueFamilyLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center text-center gap-6 px-6">
        <DnaHelix3D />
        <p
          role="status"
          className="font-mono text-sm text-muted-foreground"
        >
          Loading league&hellip;
        </p>
      </div>
    </div>
  );
}
