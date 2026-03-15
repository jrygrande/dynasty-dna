interface AssetEvent {
  id: string;
  season: string;
  week: number;
  eventType: string;
  assetKind: string;
  playerId: string | null;
  pickSeason: string | null;
  pickRound: number | null;
  fromManager: string | null;
  toManager: string | null;
  createdAt: number | null;
  details: Record<string, unknown> | null;
}

interface AssetInfo {
  kind: "player" | "pick";
  playerId?: string;
  name?: string;
  position?: string | null;
  team?: string | null;
  pickSeason?: string;
  pickRound?: number;
  pickOriginalRosterId?: number;
}

const EVENT_STYLES: Record<
  string,
  { color: string; icon: string; label: string }
> = {
  draft_selected: {
    color: "bg-blue-500",
    icon: "D",
    label: "Drafted",
  },
  trade: {
    color: "bg-purple-500",
    icon: "T",
    label: "Traded",
  },
  pick_trade: {
    color: "bg-purple-500",
    icon: "P",
    label: "Pick Traded",
  },
  waiver_add: {
    color: "bg-amber-500",
    icon: "W",
    label: "Waiver Claim",
  },
  waiver_drop: {
    color: "bg-red-500",
    icon: "W",
    label: "Waiver Drop",
  },
  free_agent_add: {
    color: "bg-green-500",
    icon: "F",
    label: "FA Pickup",
  },
  free_agent_drop: {
    color: "bg-red-500",
    icon: "F",
    label: "FA Drop",
  },
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AssetTimeline({
  events,
  asset,
}: {
  events: AssetEvent[];
  asset: AssetInfo | null;
}) {
  if (!asset) return null;

  return (
    <div>
      {/* Asset header */}
      <div className="mb-6">
        {asset.kind === "player" ? (
          <div>
            <h2 className="text-xl font-bold">{asset.name}</h2>
            <p className="text-sm text-muted-foreground">
              {asset.position} &middot; {asset.team || "Free Agent"}
            </p>
          </div>
        ) : (
          <div>
            <h2 className="text-xl font-bold">
              {asset.pickSeason} Round {asset.pickRound} Pick
            </h2>
            <p className="text-sm text-muted-foreground">
              Originally Roster #{asset.pickOriginalRosterId}
            </p>
          </div>
        )}
      </div>

      {events.length === 0 && (
        <p className="text-muted-foreground">No events found for this asset.</p>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

        <div className="space-y-4">
          {events.map((event) => {
            const style = EVENT_STYLES[event.eventType] || {
              color: "bg-gray-500",
              icon: "?",
              label: event.eventType,
            };

            return (
              <div key={event.id} className="relative pl-12">
                {/* Dot */}
                <div
                  className={`absolute left-2.5 top-1 w-4 h-4 rounded-full ${style.color} flex items-center justify-center`}
                >
                  <span className="text-[8px] font-bold text-white">
                    {style.icon}
                  </span>
                </div>

                {/* Content */}
                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold">{style.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {event.season} Week {event.week} &middot;{" "}
                      {formatDate(event.createdAt)}
                    </span>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    {event.fromManager && event.toManager && (
                      <p>
                        {event.fromManager}{" "}
                        <span className="text-foreground">&rarr;</span>{" "}
                        {event.toManager}
                      </p>
                    )}
                    {!event.fromManager && event.toManager && (
                      <p>
                        <span className="text-foreground">&rarr;</span>{" "}
                        {event.toManager}
                      </p>
                    )}
                    {event.fromManager && !event.toManager && (
                      <p>
                        {event.fromManager}{" "}
                        <span className="text-foreground">&rarr;</span> Released
                      </p>
                    )}

                    {event.eventType === "draft_selected" &&
                      event.details &&
                      typeof event.details === "object" && (
                        <p className="text-xs mt-1">
                          Pick #{(event.details as { pickNo?: number }).pickNo}, Round{" "}
                          {(event.details as { round?: number }).round}
                        </p>
                      )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
