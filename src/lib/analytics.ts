/**
 * Analytics event schema for Asset Graph Browser experiment (Issue #26).
 *
 * This is a stub sink for MVP. Events are console.debug-ed in development
 * and no-op in production until a real analytics pipeline lands.
 *
 * The schema below is the source of truth — callers depend on these event
 * names and property shapes. Treat this file as append-only with respect
 * to event names; property evolution is allowed but should be backwards
 * compatible where possible.
 *
 * ========================================================================
 * EVENT SCHEMA
 * ========================================================================
 *
 *   graph_view_opened
 *     Fires on initial page render of /league/:familyId/graph.
 *     { familyId: string;
 *       from: "overview" | "player" | "transactions" | "manager" | "deeplink";
 *       nodeCount: number;
 *       edgeCount: number;
 *       season: string; }
 *
 *   graph_filter_changed
 *     Fires on any filter mutation (seasons, managers, event types, layout).
 *     { filterName: "seasons" | "managers" | "eventTypes" | "layout";
 *       newValue: unknown; }
 *
 *   graph_focus_set
 *     Fires when a focus asset is selected (player/pick/manager + hop radius).
 *     { focusType: "player" | "pick" | "manager";
 *       hops: number; }
 *
 *   graph_node_selected
 *     Fires when a node is clicked (opens detail drawer).
 *     { kind: "manager" | "player" | "pick"; }
 *
 *   graph_edge_selected
 *     Fires when an edge is clicked (opens transaction drawer).
 *     { kind: GraphEdgeKind;
 *       hasTransactionId: boolean; }
 *
 *   graph_link_copied
 *     Fires on Copy Link button click (numerator of share rate).
 *     { hasFocus: boolean;
 *       filterCount: number; }
 *
 *   graph_mobile_bounce
 *     Fires on mobile (< 1024 px) digest render — signals the interactive
 *     graph was unavailable for this session.
 *     { familyId: string; }
 *
 * ========================================================================
 * OPERATIONAL METRIC DEFINITIONS
 * ========================================================================
 *
 *   "Multi-hop trade chain"
 *     A transaction where `adds.length + draftPicks.length >= 3`.
 *     Tracked as GraphStats.multiHopChains in API responses and exposed
 *     to the user in the GraphHeaderStats strip ("{N} multi-hop chains").
 *     This is one of the two named success metrics for the
 *     ASSET_GRAPH_BROWSER experiment.
 *
 *   "Share rate"
 *     graph_link_copied / graph_view_opened, per session.
 *     The ASSET_GRAPH_BROWSER experiment's second named success metric.
 *     Rationale: a user motivated enough to share a link is signalling
 *     that the graph told them a story the flat transaction log didn't.
 *
 * ========================================================================
 *
 * See also:
 *   - src/lib/featureFlags.ts (ASSET_GRAPH_BROWSER flag definition)
 *   - docs/experiments/asset-graph-browser.md (hypothesis, promotion criteria)
 */

/**
 * Union of all known Asset Graph Browser analytics events. Callers should
 * prefer passing one of these literals to `trackEvent` so TypeScript flags
 * typos. The signature also accepts arbitrary strings (`string & {}`) so
 * other features can reuse this sink without fighting the type system.
 */
export type GraphAnalyticsEvent =
  | "graph_view_opened"
  | "graph_filter_changed"
  | "graph_focus_set"
  | "graph_node_selected"
  | "graph_edge_selected"
  | "graph_link_copied"
  | "graph_mobile_bounce";

/**
 * Emit an analytics event.
 *
 * - Server-side (no `window`): no-op. Safe to call from shared code.
 * - Development: `console.debug` so events are visible during manual QA.
 * - Production: no-op until a real sink lands (see TODO below).
 *
 * This function never throws. Analytics must never crash the UI.
 *
 * @param name  Event name. Prefer a {@link GraphAnalyticsEvent} literal.
 * @param props Arbitrary structured properties. Keep values JSON-serialisable.
 */
export function trackEvent(
  name: GraphAnalyticsEvent | (string & {}),
  props: Record<string, unknown> = {}
): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug(`[analytics] ${name}`, props);
  }
  // TODO(#26-analytics): wire to real sink (e.g., PostHog, Plausible, or custom endpoint).
}
