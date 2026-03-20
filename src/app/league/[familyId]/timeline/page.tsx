"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { AssetTimeline, AssetIdentifier } from "@/components/AssetTimeline";

function assetKey(asset: AssetIdentifier): string {
  if (asset.kind === "player") return `player:${asset.playerId}`;
  return `pick:${asset.pickSeason}:${asset.pickRound}:${asset.pickOriginalRosterId}`;
}

export default function TimelinePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const familyId = params.familyId as string;

  // Parse initial asset from URL
  const playerId = searchParams.get("playerId");
  const pickSeason = searchParams.get("pickSeason");
  const pickRound = searchParams.get("pickRound");
  const pickOriginalRosterId = searchParams.get("pickOriginalRosterId");

  const initialAsset: AssetIdentifier | null = playerId
    ? { kind: "player", playerId }
    : pickSeason && pickRound && pickOriginalRosterId
      ? {
          kind: "pick",
          pickSeason,
          pickRound: parseInt(pickRound, 10),
          pickOriginalRosterId: parseInt(pickOriginalRosterId, 10),
        }
      : null;

  const [timelines, setTimelines] = useState<AssetIdentifier[]>(
    initialAsset ? [initialAsset] : []
  );
  const [activeTab, setActiveTab] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleAssetClick = useCallback(
    (asset: AssetIdentifier) => {
      const key = assetKey(asset);
      const existingIdx = timelines.findIndex((t) => assetKey(t) === key);

      if (existingIdx >= 0) {
        // Already open — scroll to it (desktop) or switch tab (mobile)
        setActiveTab(existingIdx);
        const el = columnRefs.current.get(key);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", inline: "start" });
          el.classList.add("ring-2", "ring-primary");
          setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
        }
        return;
      }

      // Add new timeline
      setTimelines((prev) => [...prev, asset]);
      setActiveTab(timelines.length); // new index

      // Scroll into view after render
      requestAnimationFrame(() => {
        const el = columnRefs.current.get(key);
        if (el) el.scrollIntoView({ behavior: "smooth", inline: "start" });
      });
    },
    [timelines]
  );

  const handleClose = useCallback(
    (idx: number) => {
      setTimelines((prev) => prev.filter((_, i) => i !== idx));
      if (activeTab >= idx && activeTab > 0) {
        setActiveTab(activeTab - 1);
      }
    },
    [activeTab]
  );

  // Register column ref
  const setColumnRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) columnRefs.current.set(key, el);
      else columnRefs.current.delete(key);
    },
    []
  );

  if (!initialAsset) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">
          No asset specified. Navigate here from a player page or transaction.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <Link
            href={`/league/${familyId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; League
          </Link>
          <h1 className="text-xl font-bold">Asset Timeline</h1>
        </div>
      </header>

      {/* Mobile tabs (< md) */}
      {timelines.length > 1 && (
        <div className="md:hidden border-b overflow-x-auto">
          <div className="flex" role="tablist">
            {timelines.map((t, i) => {
              const label = t.kind === "player" ? "Player" : `${t.pickSeason} R${t.pickRound}`;
              return (
              <button
                key={assetKey(t)}
                role="tab"
                aria-selected={activeTab === i}
                aria-label={label}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === i
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                {label}
                {i > 0 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClose(i);
                    }}
                    className="ml-2 text-muted-foreground hover:text-foreground"
                  >
                    &times;
                  </span>
                )}
              </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Desktop: horizontal scroll of columns */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto hidden md:flex"
      >
        {timelines.map((t, i) => (
          <div
            key={assetKey(t)}
            ref={setColumnRef(assetKey(t))}
            className="min-w-[420px] max-w-[520px] flex-shrink-0 border-r overflow-y-auto transition-shadow"
          >
            <AssetTimeline
              familyId={familyId}
              asset={t}
              onAssetClick={handleAssetClick}
              isPrimary={i === 0}
              onClose={i > 0 ? () => handleClose(i) : undefined}
            />
          </div>
        ))}
      </div>

      {/* Mobile: show active tab only */}
      <div className="flex-1 overflow-y-auto md:hidden">
        {timelines[activeTab] && (
          <AssetTimeline
            familyId={familyId}
            asset={timelines[activeTab]}
            onAssetClick={handleAssetClick}
            isPrimary={activeTab === 0}
            onClose={activeTab > 0 ? () => handleClose(activeTab) : undefined}
          />
        )}
      </div>
    </div>
  );
}
