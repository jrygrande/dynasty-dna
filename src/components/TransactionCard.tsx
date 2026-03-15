import Link from "next/link";

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
  from: string;
  to: string;
}

interface TransactionManager {
  rosterId: number;
  name: string;
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

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    trade: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    waiver:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    free_agent:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    commissioner:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  };

  const labels: Record<string, string> = {
    trade: "Trade",
    waiver: "Waiver",
    free_agent: "Free Agent",
    commissioner: "Commissioner",
  };

  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${styles[type] || "bg-gray-100 text-gray-800"}`}
    >
      {labels[type] || type}
    </span>
  );
}

export function TransactionCard({ tx, familyId }: { tx: TransactionData; familyId?: string }) {
  if (tx.type === "trade") {
    return <TradeCard tx={tx} familyId={familyId} />;
  }
  return <SimpleTransactionCard tx={tx} familyId={familyId} />;
}

function TradeCard({ tx, familyId }: { tx: TransactionData; familyId?: string }) {
  // Group adds/drops/picks by roster to show two-column trade layout
  const rosterIds = tx.managers.map((m) => m.rosterId);

  const sides = rosterIds.map((rosterId) => {
    const manager = tx.managers.find((m) => m.rosterId === rosterId);
    const received = tx.adds.filter((a) => a.rosterId === rosterId);
    const sent = tx.drops.filter((d) => d.rosterId === rosterId);
    const picksReceived = tx.draftPicks.filter(
      (p) => p.to === manager?.name
    );
    const picksSent = tx.draftPicks.filter(
      (p) => p.from === manager?.name
    );

    return {
      rosterId,
      managerName: manager?.name || `Roster ${rosterId}`,
      received,
      sent,
      picksReceived,
      picksSent,
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
            <p className="text-sm font-semibold">{side.managerName}</p>
            {side.received.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Received</p>
                {side.received.map((a) => (
                  <p key={a.playerId} className="text-sm text-green-600 dark:text-green-400">
                    + <PlayerLink playerId={a.playerId} playerName={a.playerName} familyId={familyId} />
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
                  <p key={i} className="text-sm text-green-600 dark:text-green-400">
                    + {p.season} {p.round}{getRoundSuffix(p.round)} Round Pick
                  </p>
                ))}
              </div>
            )}
            {side.sent.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Sent</p>
                {side.sent.map((d) => (
                  <p key={d.playerId} className="text-sm text-red-600 dark:text-red-400">
                    - <PlayerLink playerId={d.playerId} playerName={d.playerName} familyId={familyId} />
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
                  <p key={i} className="text-sm text-red-600 dark:text-red-400">
                    - {p.season} {p.round}{getRoundSuffix(p.round)} Round Pick
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
            <span className="text-xs text-amber-600 dark:text-amber-400 font-mono">
              ${waiverBid}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{tx.season}</span>
      </div>

      <div className="space-y-1">
        {tx.adds.map((a) => (
          <p key={a.playerId} className="text-sm">
            <span className="text-green-600 dark:text-green-400 font-medium">
              + <PlayerLink playerId={a.playerId} playerName={a.playerName} familyId={familyId} />
            </span>
            <span className="text-muted-foreground ml-2">
              &rarr; {a.managerName}
            </span>
          </p>
        ))}
        {tx.drops.map((d) => (
          <p key={d.playerId} className="text-sm">
            <span className="text-red-600 dark:text-red-400 font-medium">
              - <PlayerLink playerId={d.playerId} playerName={d.playerName} familyId={familyId} />
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
