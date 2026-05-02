import { assetKey, type GraphNode, type TransactionNode } from "@/lib/assetGraph";
import { getRoundSuffix } from "@/lib/utils";

export interface TransactionHeader {
  title: string;
  subtitle: string;
}

/** Draft cards always render expanded (single asset, nothing to hide). */
export function isHeaderExpanded(
  node: GraphNode,
  fullyExpanded: Set<string> | undefined,
): boolean {
  if (node.kind !== "transaction") return false;
  return node.txKind === "draft" || (fullyExpanded?.has(node.id) ?? false);
}

/**
 * Layout-relevant shape of a transaction card given the current expansion
 * state. Mirrors `TransactionCardChrome`'s render logic so the layout's
 * height estimate tracks what actually paints. Returns null for non-
 * transaction nodes (current rosters render at a fixed size).
 */
export function cardShape(
  node: GraphNode,
  fullyExpanded: Set<string> | undefined,
  chainAssetKeys: Set<string> | undefined,
): { assetRows: number; bucketCount: number; hasToggleBar: boolean } | null {
  if (node.kind !== "transaction") return null;
  const expanded = isHeaderExpanded(node, fullyExpanded);
  const visible = expanded
    ? node.assets
    : node.assets.filter((a) => chainAssetKeys?.has(assetKey(a)) ?? false);
  const recipients = new Set<string>();
  for (const a of visible) recipients.add(a.toUserId ?? "__none__");
  const collapsibleCount = node.assets.length - (chainAssetKeys?.size ?? 0);
  return {
    assetRows: visible.length,
    bucketCount: recipients.size,
    hasToggleBar: collapsibleCount > 0,
  };
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
 *
 * `swapName` lets demo mode substitute the per-session pseudonym at render
 * time. When omitted, real manager names render as-is.
 */
export function buildTransactionHeader(
  node: TransactionNode,
  swapName?: (userId: string, fallback: string) => string,
): TransactionHeader {
  const date = formatDate(node.createdAt, node.season, node.week);
  const resolve = (i: number): string => {
    const m = node.managers[i];
    if (!m) return "—";
    return swapName ? swapName(m.userId, m.displayName) : m.displayName;
  };
  const managerName = resolve(0);

  switch (node.txKind) {
    case "trade": {
      const a = node.managers[0] ? resolve(0) : null;
      const b = node.managers[1] ? resolve(1) : null;
      const title =
        a && b ? `${a} ↔ ${b}` : a ? a : "Trade";
      return { title, subtitle: date };
    }
    case "draft": {
      // Pick details live on `draftPick` (populated from the draft_selected
      // event), not in `assets` (which holds the player drafted). Falls
      // back to "Draft" if pick info is somehow missing.
      const pick = node.draftPick;
      const title = pick
        ? `${pick.round}${getRoundSuffix(pick.round)} round, ${pick.season}`
        : "Draft";
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
