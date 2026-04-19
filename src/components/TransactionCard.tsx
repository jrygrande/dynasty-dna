import Link from "next/link";
import type { AssetIdentifier } from "./AssetTimeline";
import { GradeBadge } from "./GradeBadge";

interface TransactionAdd {
  playerId: string;
  playerName: string;
  rosterId: number;
  managerName: string;
}

interface TransactionDrop {
  playerId: string;
  playerName: string;
  rosterId: number;
  managerName: string;
}

interface TransactionPick {
  season: string;
  round: number;
  originalRosterId: number;
  originalOwnerName?: string;
  fromRosterId: number;
  toRosterId: number;
  from: string;
  to: string;
  resolvedPlayerId?: string;
  resolvedPlayerName?: string;
}

interface TransactionManager {
  rosterId: number;
  name: string;
}

interface TradeGrade {
  rosterId: number;
  grade: string | null;
  blendedScore: number | null;
  productionWeight: number | null;
  productionWeeks: number | null;
  fantasyCalcValue: number | null;
}

export interface TransactionData {
  id: string;
  type: string;
  week: number;
  season: string;
  createdAt: number | null;
  managers: TransactionManager[];
  adds: TransactionAdd[];
  drops: TransactionDrop[];
  draftPicks: TransactionPick[];
  settings: Record<string, unknown> | null;
  grades?: TradeGrade[];
}

function PlayerLink({ playerId, playerName, familyId, className }: {
  playerId: string;
  playerName: string;
  familyId?: string;
  className?: string;
}) {
  if (!familyId) return <span className={className}>{playerName}</span>;
  return (
    <Link
      href={`/league/${familyId}/player/${playerId}`}
      className={`${className} hover:underline`}
    >
      {playerName}
    </Link>
  );
}

function getRoundSuffix(round: number): string {
  if (round === 1) return "st";
  if (round === 2) return "nd";
  if (round === 3) return "rd";
  return "th";
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TYPE_STYLES: Record<string, string> = {
  trade: "bg-grade-b/12 text-grade-b",
  waiver: "bg-grade-c/15 text-grade-c",
  free_agent: "bg-grade-a/12 text-grade-a",
  commissioner: "bg-chart-4/15 text-chart-4",
};

const TYPE_LABELS: Record<string, string> = {
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_STYLES[type] || "bg-muted text-muted-foreground"}`}
    >
      {TYPE_LABELS[type] || type}
    </span>
  );
}

function GradeContext({ productionWeight }: { productionWeight: number | null }) {
  if (productionWeight === null || productionWeight === undefined) return null;
  const pct = Math.round(productionWeight * 100);
  const label = pct === 0 ? "Value-only (no games yet)" : `${pct}% production-based`;
  return (
    <span className="text-[10px] text-muted-foreground">{label}</span>
  );
}

export function TransactionCard({ tx, familyId, onAssetClick }: {
  tx: TransactionData;
  familyId?: string;
  onAssetClick?: (asset: AssetIdentifier) => void;
}) {
  if (tx.type === "trade") {
    return <TradeCard tx={tx} familyId={familyId} onAssetClick={onAssetClick} />;
  }
  return <SimpleTransactionCard tx={tx} familyId={familyId} />;
}

function TimelineIcon({ onClick }: { onClick: () => void }) {
  return (
    <span
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="text-xs text-muted-foreground hover:text-foreground ml-1 cursor-pointer inline-block"
      title="Open timeline"
    >
      &#x2197;
    </span>
  );
}

function TradeCard({ tx, familyId, onAssetClick }: { tx: TransactionData; familyId?: string; onAssetClick?: (asset: AssetIdentifier) => void }) {
  // Group adds/drops/picks by roster to show two-column trade layout
  const rosterIds = tx.managers.map((m) => m.rosterId);
  const gradesByRoster = new Map(
    (tx.grades || []).map((g) => [g.rosterId, g])
  );

  const sides = rosterIds.map((rosterId) => {
    const manager = tx.managers.find((m) => m.rosterId === rosterId);
    const received = tx.adds.filter((a) => a.rosterId === rosterId);
    const sent = tx.drops.filter((d) => d.rosterId === rosterId);
    const picksReceived = tx.draftPicks.filter(
      (p) => p.toRosterId === rosterId
    );
    const picksSent = tx.draftPicks.filter(
      (p) => p.fromRosterId === rosterId
    );
    const grade = gradesByRoster.get(rosterId);

    return {
      rosterId,
      managerName: manager?.name || `Roster ${rosterId}`,
      received,
      sent,
      picksReceived,
      picksSent,
      grade,
    };
  });

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TypeBadge type="trade" />
          <span className="text-xs text-muted-foreground">
            Week {tx.week} &middot; {formatDate(tx.createdAt)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{tx.season}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sides.map((side) => (
          <div key={side.rosterId} className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{side.managerName}</p>
              {side.grade?.grade && <GradeBadge grade={side.grade.grade} />}
            </div>
            {side.grade && (
              <div className="flex items-center gap-2">
                <GradeContext productionWeight={side.grade.productionWeight} />
                {side.grade.fantasyCalcValue != null && side.grade.fantasyCalcValue > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(side.grade.fantasyCalcValue).toLocaleString()} value received
                  </span>
                )}
              </div>
            )}
            {side.received.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Received</p>
                {side.received.map((a) => (
                  <p key={a.playerId} className="text-sm text-primary">
                    + <PlayerLink playerId={a.playerId} playerName={a.playerName} familyId={familyId} />
                    {onAssetClick && (
                      <TimelineIcon onClick={() => onAssetClick({ kind: "player", playerId: a.playerId })} />
                    )}
                  </p>
                ))}
              </div>
            )}
            {side.picksReceived.length > 0 && (
              <div>
                {side.received.length === 0 && (
                  <p className="text-xs text-muted-foreground mb-1">Received</p>
                )}
                {side.picksReceived.map((p, i) => (
                  <p key={i} className="text-sm text-primary">
                    + {p.season} {p.round}{getRoundSuffix(p.round)} Round Pick
                    {p.originalOwnerName && p.originalOwnerName !== side.managerName && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({p.originalOwnerName}&apos;s)
                      </span>
                    )}
                    {p.resolvedPlayerName && (
                      <span className="text-xs text-muted-foreground ml-1">
                        &rarr; <PlayerLink playerId={p.resolvedPlayerId!} playerName={p.resolvedPlayerName} familyId={familyId} className="text-xs text-muted-foreground" />
                      </span>
                    )}
                    {onAssetClick && (
                      <TimelineIcon onClick={() => onAssetClick({ kind: "pick", pickSeason: p.season, pickRound: p.round, pickOriginalRosterId: p.originalRosterId })} />
                    )}
                  </p>
                ))}
              </div>
            )}
            {side.sent.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Sent</p>
                {side.sent.map((d) => (
                  <p key={d.playerId} className="text-sm text-muted-foreground">
                    − <PlayerLink playerId={d.playerId} playerName={d.playerName} familyId={familyId} />
                    {onAssetClick && (
                      <TimelineIcon onClick={() => onAssetClick({ kind: "player", playerId: d.playerId })} />
                    )}
                  </p>
                ))}
              </div>
            )}
            {side.picksSent.length > 0 && (
              <div>
                {side.sent.length === 0 && (
                  <p className="text-xs text-muted-foreground mb-1">Sent</p>
                )}
                {side.picksSent.map((p, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    − {p.season} {p.round}{getRoundSuffix(p.round)} Round Pick
                    {p.originalOwnerName && p.originalOwnerName !== side.managerName && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({p.originalOwnerName}&apos;s)
                      </span>
                    )}
                    {p.resolvedPlayerName && (
                      <span className="text-xs text-muted-foreground ml-1">
                        &rarr; <PlayerLink playerId={p.resolvedPlayerId!} playerName={p.resolvedPlayerName} familyId={familyId} className="text-xs text-muted-foreground" />
                      </span>
                    )}
                    {onAssetClick && (
                      <TimelineIcon onClick={() => onAssetClick({ kind: "pick", pickSeason: p.season, pickRound: p.round, pickOriginalRosterId: p.originalRosterId })} />
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SimpleTransactionCard({ tx, familyId }: { tx: TransactionData; familyId?: string }) {
  const waiverBid =
    tx.settings && typeof tx.settings === "object" && "waiver_bid" in tx.settings
      ? (tx.settings as { waiver_bid: number }).waiver_bid
      : null;

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TypeBadge type={tx.type} />
          <span className="text-xs text-muted-foreground">
            Week {tx.week} &middot; {formatDate(tx.createdAt)}
          </span>
          {waiverBid !== null && (
            <span className="text-xs text-foreground font-mono">
              ${waiverBid}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{tx.season}</span>
      </div>

      <div className="space-y-1">
        {tx.adds.map((a) => (
          <p key={a.playerId} className="text-sm">
            <span className="text-primary font-medium">
              + <PlayerLink playerId={a.playerId} playerName={a.playerName} familyId={familyId} />
            </span>
            <span className="text-muted-foreground ml-2">
              &rarr; {a.managerName}
            </span>
          </p>
        ))}
        {tx.drops.map((d) => (
          <p key={d.playerId} className="text-sm">
            <span className="text-muted-foreground font-medium">
              − <PlayerLink playerId={d.playerId} playerName={d.playerName} familyId={familyId} />
            </span>
            <span className="text-muted-foreground ml-2">
              from {d.managerName}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
