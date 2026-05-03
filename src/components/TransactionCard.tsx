import Link from "next/link";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { GradeBadge } from "./GradeBadge";
import { ManagerName } from "./ManagerName";
import { getRoundSuffix } from "@/lib/utils";

// Subtle hover treatment for player-name links: an underline that fades in
// on hover. Avoids the "dead text" problem where the link is the same color
// as surrounding text.
const PLAYER_LINK_HOVER =
  "underline decoration-current/0 underline-offset-2 hover:decoration-current/60 transition-[text-decoration-color]";

function AssetSign({ kind }: { kind: "add" | "drop" }) {
  const Icon = kind === "add" ? Plus : Minus;
  return <Icon className="h-3 w-3 inline-block align-text-bottom" aria-hidden />;
}

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
      className={`${className ?? ""} ${PLAYER_LINK_HOVER}`}
    >
      {playerName}
    </Link>
  );
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

export function TransactionCard({ tx, familyId }: {
  tx: TransactionData;
  familyId?: string;
}) {
  if (tx.type === "trade") {
    return <TradeCard tx={tx} familyId={familyId} />;
  }
  return <SimpleTransactionCard tx={tx} familyId={familyId} />;
}

function TradeCard({ tx, familyId }: { tx: TransactionData; familyId?: string }) {
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
              <p className="text-sm font-semibold">
                <ManagerName
                  rosterId={side.rosterId}
                  displayName={side.managerName}
                  variant="display-only"
                />
              </p>
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
                    <AssetSign kind="add" /> <PlayerLink playerId={a.playerId} playerName={a.playerName} familyId={familyId} />
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
                    <AssetSign kind="add" /> {p.season} {p.round}{getRoundSuffix(p.round)} Round Pick
                    {p.originalOwnerName && p.originalRosterId !== side.rosterId && (
                      <span className="text-xs text-muted-foreground ml-1">
                        (
                        <ManagerName
                          rosterId={p.originalRosterId}
                          displayName={p.originalOwnerName}
                          variant="display-only"
                        />
                        &apos;s)
                      </span>
                    )}
                    {p.resolvedPlayerName && (
                      <span className="text-xs text-muted-foreground ml-1 inline-flex items-center gap-1 align-middle">
                        <ArrowRight className="h-3 w-3" />
                        <PlayerLink playerId={p.resolvedPlayerId!} playerName={p.resolvedPlayerName} familyId={familyId} className="text-xs text-muted-foreground" />
                      </span>
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
                    <AssetSign kind="drop" /> <PlayerLink playerId={d.playerId} playerName={d.playerName} familyId={familyId} />
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
                    <AssetSign kind="drop" /> {p.season} {p.round}{getRoundSuffix(p.round)} Round Pick
                    {p.originalOwnerName && p.originalRosterId !== side.rosterId && (
                      <span className="text-xs text-muted-foreground ml-1">
                        (
                        <ManagerName
                          rosterId={p.originalRosterId}
                          displayName={p.originalOwnerName}
                          variant="display-only"
                        />
                        &apos;s)
                      </span>
                    )}
                    {p.resolvedPlayerName && (
                      <span className="text-xs text-muted-foreground ml-1 inline-flex items-center gap-1 align-middle">
                        <ArrowRight className="h-3 w-3" />
                        <PlayerLink playerId={p.resolvedPlayerId!} playerName={p.resolvedPlayerName} familyId={familyId} className="text-xs text-muted-foreground" />
                      </span>
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
              <AssetSign kind="add" /> <PlayerLink playerId={a.playerId} playerName={a.playerName} familyId={familyId} />
            </span>
            <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 align-middle">
              <ArrowRight className="h-3 w-3" />
              <ManagerName
                rosterId={a.rosterId}
                displayName={a.managerName}
                variant="display-only"
              />
            </span>
          </p>
        ))}
        {tx.drops.map((d) => (
          <p key={d.playerId} className="text-sm">
            <span className="text-muted-foreground font-medium">
              <AssetSign kind="drop" /> <PlayerLink playerId={d.playerId} playerName={d.playerName} familyId={familyId} />
            </span>
            <span className="text-muted-foreground ml-2">
              from{" "}
              <ManagerName
                rosterId={d.rosterId}
                displayName={d.managerName}
                variant="display-only"
              />
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
