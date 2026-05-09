"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DnaHelix } from "./DnaHelix";

/**
 * Cold-sync loading screen (#151).
 *
 * Drives the chunked-tick polling loop that turns first-time indexing into
 * a brand moment:
 *
 *   1. Mount: kick off `POST /api/sync/start` with `{ familyId }` to make
 *      sure a `syncJobs` row exists. The route returns the canonical
 *      `jobId` (whether brand-new or already in flight).
 *   2. Every `POLL_MS` ms, call `POST /api/sync/jobs/[jobId]/tick`. The
 *      tick route enforces its own 25s execution budget and is idempotent
 *      via watermarks — closing the tab and coming back picks up cleanly.
 *   3. When the tick reports `status: "completed"` we navigate to the
 *      league dashboard. On `failed` we surface the error inline (the
 *      route still returns 200; the user can manually retry by reloading).
 *
 * Accessibility:
 *   - `role="status"` + `aria-live="polite"` on the progress wrapper so the
 *     stage label is announced as it changes.
 *   - The helix itself is decorative — its `role="img"` is set inside
 *     `DnaHelix`.
 *   - Reduced-motion is respected by the helix component itself.
 *
 * The component never throws — network failures during polling are
 * collapsed into "unable to reach the server" copy and the loop continues
 * with a small backoff. Cold sync is the user's first impression; we'd
 * rather absorb a transient error than blank-screen them.
 */

interface ColdSyncLoadingScreenProps {
  familyId: string;
  /**
   * Optional jobId hint from the server (when the layout already had one).
   * If omitted we'll let the start route allocate one.
   */
  initialJobId?: string;
}

interface TickResponse {
  status: "in_progress" | "completed" | "failed";
  stagesCompleted: number;
  stagesTotal: number;
  currentStageLabel: string | null;
  error?: string | null;
}

const POLL_MS = 1000;
const ERROR_BACKOFF_MS = 3000;
const DEFAULT_TOTAL_STAGES = 8; // optimistic placeholder until first tick

/**
 * Convert a stage key like `"2024:transactions"` into a friendly label.
 * The tick route is the source of truth — this is just the on-mount /
 * idle-stage fallback before we have a label.
 */
function defaultStageLabel(): string {
  return "Sequencing seasons";
}

export function ColdSyncLoadingScreen({
  familyId,
  initialJobId,
}: ColdSyncLoadingScreenProps) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | undefined>(initialJobId);
  const [status, setStatus] = useState<TickResponse["status"]>("in_progress");
  const [stagesCompleted, setStagesCompleted] = useState(0);
  const [stagesTotal, setStagesTotal] = useState(DEFAULT_TOTAL_STAGES);
  const [currentStage, setCurrentStage] = useState<string | null>(
    defaultStageLabel()
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transientError, setTransientError] = useState(false);

  // Refs to keep the polling loop closure stable.
  const stoppedRef = useRef(false);
  const tickInFlightRef = useRef(false);

  // Step 1: ensure we have a jobId. Either the layout already passed one in
  // (preferred — no extra round-trip), or we allocate via /api/sync/start.
  useEffect(() => {
    if (jobId || stoppedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sync/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ familyId }),
        });
        if (!res.ok) {
          // Surface the error but let the polling loop run on the next
          // mount — this is recoverable by reload.
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            body.error ?? `Failed to start sync (HTTP ${res.status})`
          );
        }
        const body = (await res.json()) as { jobId: string };
        if (!cancelled) setJobId(body.jobId);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Couldn't start sync — please reload."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familyId, jobId]);

  // Step 2: polling loop. Owns its own setTimeout chain so we don't
  // double-tick if React StrictMode mounts the effect twice in dev.
  useEffect(() => {
    if (!jobId) return;
    stoppedRef.current = false;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stoppedRef.current) return;
      if (tickInFlightRef.current) {
        // Reschedule if a previous tick is still in flight (long sleeper).
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      tickInFlightRef.current = true;
      try {
        const res = await fetch(`/api/sync/jobs/${jobId}/tick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          throw new Error(`Tick failed with HTTP ${res.status}`);
        }
        const body = (await res.json()) as TickResponse;
        setStatus(body.status);
        setStagesCompleted(body.stagesCompleted);
        if (body.stagesTotal > 0) setStagesTotal(body.stagesTotal);
        if (body.currentStageLabel) setCurrentStage(body.currentStageLabel);
        if (body.error) setErrorMessage(body.error);
        setTransientError(false);

        if (body.status === "completed") {
          stoppedRef.current = true;
          // Hard refresh + navigate so the layout's freshness gate re-runs
          // with the now-fresh data.
          router.replace(`/league/${familyId}`);
          router.refresh();
          return;
        }

        if (body.status === "failed") {
          stoppedRef.current = true;
          return;
        }

        timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (stoppedRef.current) return;
        setTransientError(true);
        // Keep the user informed but don't surface every blip.
        if (err instanceof Error && process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[ColdSyncLoadingScreen] tick failed:", err);
        }
        timer = setTimeout(tick, ERROR_BACKOFF_MS);
      } finally {
        tickInFlightRef.current = false;
      }
    };

    // Kick off immediately rather than waiting POLL_MS.
    timer = setTimeout(tick, 0);

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, familyId, router]);

  // Derive UI: per the locked design, the suffix is `season {current} of
  // {total}` once a per-season stage is in flight. When we don't have a
  // season-prefixed stage yet, fall back to the raw label.
  const seasonHint = currentStage ? extractSeasonHint(currentStage) : null;
  const progressPct = stagesTotal > 0
    ? Math.min(100, Math.round((stagesCompleted / stagesTotal) * 100))
    : 0;

  return (
    <div
      className="min-h-[60vh] flex items-center justify-center bg-background"
      data-family-id={familyId}
      data-job-id={jobId ?? ""}
      data-testid="cold-sync-loading"
    >
      <div className="flex flex-col items-center text-center max-w-md px-6 gap-6">
        <DnaHelix />

        <div role="status" aria-live="polite" className="space-y-2">
          <p className="font-serif text-2xl text-foreground">
            Sequencing your league&rsquo;s DNA&hellip;
          </p>
          {status === "failed" ? (
            <p className="font-mono text-sm text-destructive">
              {errorMessage ?? "Sync failed. Please reload to retry."}
            </p>
          ) : seasonHint ? (
            <p
              className="font-mono text-sm text-muted-foreground"
              data-testid="cold-sync-suffix"
            >
              season {seasonHint.current} of {seasonHint.total}
            </p>
          ) : (
            <p
              className="font-mono text-sm text-muted-foreground"
              data-testid="cold-sync-suffix"
            >
              {currentStage ?? defaultStageLabel()}
            </p>
          )}
        </div>

        {/* Progress strip — sage on muted, no raw Tailwind colors */}
        <div
          className="w-full h-1 rounded-full bg-muted overflow-hidden"
          aria-hidden="true"
        >
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
            data-testid="cold-sync-progress-bar"
          />
        </div>

        {transientError && status !== "failed" && (
          <p className="font-mono text-xs text-muted-foreground/80">
            Reconnecting&hellip;
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Pull `(current, total)` out of a stage label like
 * `"2024:transactions"`. We surface the season number not the stage name
 * because it's the unit users actually grok — "season 3 of 5" reads as
 * progress; "2024:transactions" reads as jargon.
 *
 * Returns null when the label doesn't carry a year prefix.
 */
function extractSeasonHint(
  label: string
): { current: number; total: number } | null {
  const match = label.match(/^season (\d+)\s+of\s+(\d+)/i);
  if (match) {
    return { current: Number(match[1]), total: Number(match[2]) };
  }
  return null;
}

export default ColdSyncLoadingScreen;
