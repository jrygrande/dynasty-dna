"use client";

import { useEffect, useState } from "react";
import { TransactionCard, TransactionData } from "./TransactionCard";
import { StintCard, StintData } from "./StintCard";

// ============================================================
// Types
// ============================================================

export type AssetIdentifier =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; pickSeason: string; pickRound: number; pickOriginalRosterId: number };

interface AssetInfo {
  kind: "player" | "pick";
  playerId?: string;
  name?: string;
  position?: string | null;
  team?: string | null;
  pickSeason?: string;
  pickRound?: number;
  pickOriginalOwner?: string | null;
}

interface EventData {
  id: string;
  season: string;
  week: number;
  eventType: string;
  createdAt: number | null;
  transaction: TransactionData | null;
  draftDetails?: { pickNo: number; round: number; isKeeper: boolean };
}

type TimelineEntry =
  | { type: "event"; event: EventData }
  | { type: "stint"; stint: StintData };

type EventStyle = { dot: string; text: string; icon: string; label: string };

/* Add vs drop is conveyed by filled vs outlined dot, not just by opacity —
   at 20px an alpha shift alone is near-invisible (and inaccessible). */
const EVENT_STYLES: Record<string, EventStyle> = {
  draft_selected: { dot: "bg-primary", text: "text-primary-foreground", icon: "D", label: "Drafted" },
  trade: { dot: "bg-grade-b", text: "text-white", icon: "T", label: "Traded" },
  pick_trade: { dot: "bg-grade-b", text: "text-white", icon: "P", label: "Pick traded" },
  waiver_add: { dot: "bg-grade-c", text: "text-white", icon: "W", label: "Waiver claim" },
  waiver_drop: { dot: "bg-background border-2 border-grade-c", text: "text-grade-c", icon: "W", label: "Waiver drop" },
  free_agent_add: { dot: "bg-grade-a", text: "text-white", icon: "F", label: "FA pickup" },
  free_agent_drop: { dot: "bg-background border-2 border-grade-a", text: "text-grade-a", icon: "F", label: "FA drop" },
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ============================================================
// Component
// ============================================================

interface AssetTimelineProps {
  familyId: string;
  asset: AssetIdentifier;
  onAssetClick?: (asset: AssetIdentifier) => void;
  isPrimary?: boolean;
  onClose?: () => void;
}

export function AssetTimeline({
  familyId,
  asset,
  onAssetClick,
  isPrimary = true,
  onClose,
}: AssetTimelineProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [assetInfo, setAssetInfo] = useState<AssetInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (asset.kind === "player") {
        params.set("playerId", asset.playerId);
      } else {
        params.set("pickSeason", asset.pickSeason);
        params.set("pickRound", String(asset.pickRound));
        params.set("pickOriginalRosterId", String(asset.pickOriginalRosterId));
      }

      try {
        const res = await fetch(
          `/api/leagues/${familyId}/asset-timeline?${params.toString()}`
        );
        if (!res.ok) {
          setError("Failed to load timeline");
          return;
        }
        const data = await res.json();
        setAssetInfo(data.asset);
        setEntries(data.entries || []);
      } catch {
        setError("Failed to load timeline");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [familyId, asset]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse text-muted-foreground">Loading timeline...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  const assetKind = assetInfo?.kind || "player";

  return (
    <div className="p-4">
      {/* Asset header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          {assetInfo?.kind === "player" ? (
            <>
              <h2 className="text-xl font-bold">{assetInfo.name}</h2>
              <p className="text-sm text-muted-foreground">
                {assetInfo.position} &middot; {assetInfo.team || "Free Agent"}
              </p>
            </>
          ) : assetInfo?.kind === "pick" ? (
            <>
              <h2 className="text-xl font-bold">
                {assetInfo.pickSeason} Round {assetInfo.pickRound} Pick
              </h2>
              {assetInfo.pickOriginalOwner && (
                <p className="text-sm text-muted-foreground">
                  Originally {assetInfo.pickOriginalOwner}&apos;s
                </p>
              )}
            </>
          ) : null}
        </div>
        {!isPrimary && onClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg px-2"
            aria-label="Close timeline"
          >
            &times;
          </button>
        )}
      </div>

      {entries.length === 0 && (
        <p className="text-muted-foreground">No events found for this asset.</p>
      )}

      {/* Timeline */}
      <div className="relative space-y-2">
        {/* Vertical line */}
        <div className="absolute left-[18px] top-0 bottom-0 w-0.5 bg-border" />

        {entries.map((entry, i) => {
          if (entry.type === "stint") {
            return (
              <StintCard
                key={`stint-${i}`}
                stint={entry.stint}
                assetKind={assetKind}
              />
            );
          }

          const event = entry.event;
          const style: EventStyle = EVENT_STYLES[event.eventType] || {
            dot: "bg-muted-foreground",
            text: "text-white",
            icon: "?",
            label: event.eventType,
          };

          // For trade/pick_trade events with enriched transaction, show full card
          if (event.transaction && (event.eventType === "trade" || event.eventType === "pick_trade")) {
            return (
              <div key={event.id} className="relative pl-12">
                {/* Event dot */}
                <div
                  className={`absolute left-[10px] top-3 w-5 h-5 rounded-full ${style.dot} flex items-center justify-center z-10`}
                >
                  <span className={`text-[9px] font-bold ${style.text}`}>{style.icon}</span>
                </div>

                <div className="mb-1">
                  <span className="text-xs text-muted-foreground">
                    {event.season} Week {event.week} &middot; {formatDate(event.createdAt)}
                  </span>
                </div>
                <TransactionCard
                  tx={event.transaction}
                  familyId={familyId}
                  onAssetClick={onAssetClick}
                />
              </div>
            );
          }

          // Simple event card (draft, waiver, FA)
          return (
            <div key={event.id} className="relative pl-12">
              {/* Event dot */}
              <div
                className={`absolute left-[10px] top-3 w-5 h-5 rounded-full ${style.dot} flex items-center justify-center z-10`}
              >
                <span className={`text-[9px] font-bold ${style.text}`}>{style.icon}</span>
              </div>

              <div className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">{style.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {event.season} Week {event.week} &middot; {formatDate(event.createdAt)}
                  </span>
                </div>

                {event.draftDetails && (
                  <p className="text-xs text-muted-foreground">
                    Pick #{event.draftDetails.pickNo}, Round {event.draftDetails.round}
                    {event.draftDetails.isKeeper && (
                      <span className="ml-1 text-primary">(Keeper)</span>
                    )}
                  </p>
                )}

                {/* For non-trade events with a transaction, show basic add/drop info */}
                {event.transaction && event.eventType !== "trade" && (
                  <div className="text-sm text-muted-foreground mt-1">
                    {event.transaction.adds.map((a) => (
                      <p key={a.playerId} className="text-primary">
                        + {a.playerName} → {a.managerName}
                      </p>
                    ))}
                    {event.transaction.drops.map((d) => (
                      <p key={d.playerId} className="text-muted-foreground">
                        − {d.playerName} from {d.managerName}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
