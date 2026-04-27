import type { TransactionNode } from "@/lib/assetGraph";
import { getRoundSuffix } from "@/lib/utils";

export interface TransactionHeader {
  title: string;
  subtitle: string;
}

/**
 * Format a transaction's date. Falls back to "season · Wweek" when the
 * createdAt timestamp is missing or unparseable.
 */
export function formatDate(
  createdAt: number | null,
  season: string,
  week: number,
): string {
  if (!createdAt) return week > 0 ? `${season} · W${week}` : season;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return season;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

/**
 * Build the human-readable header for a transaction card.
 *
 * Title varies by txKind; subtitle is always the formatted date,
 * except for drafts where the manager name is folded in.
 */
export function buildTransactionHeader(node: TransactionNode): TransactionHeader {
  const date = formatDate(node.createdAt, node.season, node.week);
  const managerName = node.managers[0]?.displayName ?? "—";

  switch (node.txKind) {
    case "trade": {
      const a = node.managers[0]?.displayName;
      const b = node.managers[1]?.displayName;
      const title =
        a && b ? `${a} ↔ ${b}` : a ? a : "Trade";
      return { title, subtitle: date };
    }
    case "draft": {
      const firstPick = node.assets.find((a) => a.kind === "pick");
      const round = firstPick?.pickRound;
      const title =
        round != null ? `${round}${getRoundSuffix(round)} round` : "Draft";
      return { title, subtitle: `${managerName} · ${date}` };
    }
    case "waiver":
      return { title: `Waiver claim by ${managerName}`, subtitle: date };
    case "free_agent":
      return { title: `Free-agent signing by ${managerName}`, subtitle: date };
    case "commissioner":
      return { title: `Commissioner action — ${managerName}`, subtitle: date };
  }
}
