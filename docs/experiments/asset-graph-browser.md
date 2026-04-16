# Experiment: Asset Graph Browser

**Flag:** `ASSET_GRAPH_BROWSER` (in `src/lib/featureFlags.ts`)
**Tracking issue:** https://github.com/jrygrandes-projects/dynasty-dna/issues/26
**Status:** disabled → experiment (TBD) → enabled (TBD)
**Owner:** @ryan

## Hypothesis

> Visualizing the network of trades surfaces non-obvious patterns — multi-hop
> chains, pick provenance — that the flat transaction log can't show.

Dynasty leagues accumulate years of transactions, and the existing
`/transactions` and `/timeline` pages render that history as a flat, reverse-
chronological list. A list is a faithful record but a poor *narrative* device:
when Manager A trades a 2024 2nd to Manager B, who flips it to Manager C, who
drafts Player X, the three rows that encode that chain sit on different pages
of the log, weeks or seasons apart. The story — that Player X's path to his
current roster passes through three managers and a draft pick — is latent in
the data but invisible on the page.

A node-link graph makes that latent structure manifest. Shared nodes
collapse repetition (Pick nodes keyed by `(leagueId, season, round, origRosterId)`
appear once regardless of how many times they change hands), and the edges
between them literally trace the chain. We expect two behavioural shifts: (1)
users will discover trade chains they never noticed in the list, and (2) those
discoveries will be interesting enough to share — the share button is our
proxy for "this told me something worth telling someone else."

We are less sure about the second-order effects. It's plausible that managers
who see their league as a graph will reason differently about future trades
(pick provenance matters more when you can see it), but we are not designing
for that here. MVP success is measured on discovery and sharing, not on
downstream trade behaviour.

## MVP scope

A desktop-first, reactflow-powered canvas at `/league/[familyId]/graph` that
renders all managers, players, and draft picks involved in trades, free-agent
adds, waiver adds, and draft selections across a league family, with filters
for seasons, managers, and event types, plus a focus-on-asset mode that hides
everything outside a configurable hop radius.

What shipped:

- New route `/league/[familyId]/graph` (client component, URL-param-driven).
- New API endpoint `GET /api/leagues/[familyId]/graph` returning a typed
  `GraphResponse` with pre-computed node positions.
- Three node kinds (Manager, Player, Pick) and eight edge kinds
  (`trade_out`, `trade_in`, `pick_trade_out`, `pick_trade_in`,
  `draft_selected_mgr`, `draft_selected_pick`, `waiver_add`, `free_agent_add`).
- Filters: seasons (multi-select, default = current season only), managers
  (multi-select), event types (5 checkboxes), focus-on-asset combobox with
  configurable hop radius (default 2).
- Pre-focus on the highest-hop transaction on first load — the first paint
  shows a value moment, not an empty canvas.
- Right-side detail drawer. Clicking an edge shows a full `TransactionCard`;
  clicking a node shows a summary with a link to `/timeline`.
- Header stats strip: "{N} trades · {N} multi-hop chains · {N} picks traded
  in {seasonRange}" — an at-a-glance signal that the graph contains something
  interesting.
- Copy Link button with toast confirmation (serves as the numerator of the
  share-rate metric).
- Feature-flagged entry points from `/league/[familyId]` (overview),
  `/player`, `/transactions`, and `/manager` pages.
- Mobile (`<1024 px`) digest: top trades by hop count, manager-to-manager
  trade frequency matrix, and "multi-hop chains this season" count — a
  read-only view, not a dead-end, that also fires `graph_mobile_bounce`
  so we can measure mobile share of traffic.
- Two layouts: season-banded hand-rolled (default) and dagre
  (`?layout=dagre`). Both run deterministically on the server so first
  paint has stable positions.
- Analytics stub (`src/lib/analytics.ts`) with the frozen event schema.
- React error boundary wrapping the canvas so reactflow exceptions do not
  crash the page.

### What we deliberately did not ship

- **`#26a` Provenance UI polish** — chains are already *visible* in the
  graph as sequences of edges through shared pick nodes. Deferred: drawer
  breadcrumb text ("Originally A → B → C → Player X"), auto-highlight
  chain-only path on pick hover, and a dedicated chain-filter mode. Deferred
  because the raw chain is already present; polish can come after we see
  which chains users actually care about.
- **`#26c-png-export` PNG/SVG export** — nice-to-have but not required for
  the hypothesis. Deferred until we see share-rate signal; if users copy
  links readily there's less need for an image format.
- **`#26d` Time-scrubber animation** — a scrubbed-through-time view is a
  legitimately different feature, not a polish item. Scoped out to keep
  MVP honest.
- **`#26e` Position/grade/roster filters** — the five filter dimensions
  shipped are enough to test the core hypothesis. More filters will likely
  be needed once users actually land on the page, but we want to see what
  they reach for rather than guess.
- **`#26g` Full keyboard/WCAG a11y** — the drawer is keyboard-accessible
  (focus trap, Esc closes) and nodes have a focus ring, but full graph
  keyboard navigation is deferred. Known gap.
- **`#26h` Trade-detail deep-link page** — would let the mobile digest
  link directly to a single trade instead of falling back to the list.
  Deferred as a standalone UX improvement.
- **Mobile interactive graph** — the digest ships; mobile interactive
  graph is deferred. The interactive experience on a small screen is a
  different design problem.
- **Waiver/FA drop edges** — drops clutter the canvas without adding
  narrative value (the interesting story is the add). Proposed as "won't
  do" on `#26f`.
- **Server-side pre-aggregation / caching** — gated on observed perf
  problems. The default filter (current season only) keeps edge counts in
  the low hundreds.
- **Commissioner events** — not part of the trade narrative.

## Operational metric definitions

Loose, qualitative metric names get reinterpreted over time. Pinning the
definitions in-repo keeps the experiment honest.

### Multi-hop trade chain

A transaction where `adds.length + draftPicks.length >= 3`. In practice this
captures 3-team trades, 2-team trades that swap multiple players + picks, and
any other transaction with enough legs that the graph topology is richer than
a single edge pair.

- Computed server-side in `buildGraphFromEvents` → `GraphStats.multiHopChains`.
- Surfaced to the user in `GraphHeaderStats` as "N multi-hop chains".
- Surfaced to us as the numerator of the experiment's first success metric.

### Share rate

`graph_link_copied / graph_view_opened`, per session.

- Numerator: count of `graph_link_copied` events in a session (a user may
  copy multiple variations of a URL while exploring; each copy counts).
- Denominator: count of `graph_view_opened` events in the same session.
- Computed at analysis time over the event stream. Not pre-aggregated.

A share rate well above background for comparable pages (the flat
`/transactions` list gets ~0 shares today) is the bar. We'll pick an exact
threshold once we see the distribution.

## Promotion criteria

### `disabled` → `experiment`

Ship the MVP behind `disabled`, verify in preview, then flip to
`experiment` with `rolloutPercent: 50` when all of the following are true:

- All Phase 1 module PRs merged and the E2E checklist in
  `.claude/plans/dynamic-honking-treasure.md` §Testing passes locally on
  Ryan's family.
- `npm run build` + `npm run lint` + `npm test` pass in CI.
- First-paint < 2 s on Ryan's family (10 teams, 5 seasons, ~1.5–2k edges)
  with default filters.
- No uncaught exceptions in the reactflow error boundary during the manual
  E2E pass.
- Analytics events verified in `console.debug` output for all seven event
  types during the manual pass.
- Promotion PR is its own small change — flag flip only, no code changes —
  so rollback is trivial.

### `experiment` → `enabled`

Flip to `enabled` (100% of users) when all of the following are true,
measured over a window of at least 2 weeks at 50% rollout:

- **Multi-hop chain discovery signal is positive.** Users who land on the
  graph view engage with at least one multi-hop-chain edge or node at a
  rate materially above the ambient edge-click rate. Exact threshold set
  once we see the distribution — we will not hand-wave this past ourselves.
- **Share rate is non-trivial.** Meaningfully above the baseline share
  rate on comparable pages (the `/transactions` list). A number that, if
  pasted into a PM review, wouldn't embarrass.
- **No regressions elsewhere.** No increase in error rate on pages that
  link into `/graph`. No perf regression on the overview page from
  rendering the "Trade network" entry point.
- **Zero unresolved P0/P1 issues** tagged against the graph route in the
  experiment window.

### `experiment` → `disabled` (kill switch)

Flip back to `disabled` immediately if any of the following happen:

- Page errors out for > 1% of users.
- First-paint > 5 s for the median user.
- A critical data-correctness bug is found (wrong manager on an edge,
  phantom trades, missing picks) — correctness beats velocity.
- The reactflow error boundary catches > 0.5% of views.

Flag flip is a one-line change; no code revert required. Entry points
disappear immediately; direct `/graph` URLs continue to work so shared
links don't 404 mid-experiment (graceful degradation — the page itself is
not gated by the flag, only the entry points).

## Analytics

Event schema and operational metric definitions are frozen in
[`src/lib/analytics.ts`](../../src/lib/analytics.ts). The sink is currently
a `console.debug` stub in development and a no-op in production; a real
pipeline is tracked in the `#26-analytics` TODO in that file.

Do not add new event names without updating both the JSDoc schema in
`analytics.ts` and this document's operational metric section.

## Known limitations (v1)

- **Desktop only.** Screens under 1024 px get the static digest, not the
  interactive graph. The digest is a real view, not a dead-end, but it is
  not a substitute for the graph.
- **No keyboard navigation on the canvas.** The drawer is keyboard-
  accessible (Esc closes, focus trap) and nodes have a focus ring, but
  tabbing from node to node across the canvas is not implemented. Tracked
  in `#26g`.
- **No PNG/SVG export.** Share is URL-only in v1.
- **No time scrubber.** The graph is a single snapshot filtered by season
  selection. An animated replay across time is `#26d`.
- **Drops not rendered.** Only adds show up. See `#26f`.
- **Layout is either "band" or "dagre" and both are hand-rolled
  heuristics.** They will produce readable graphs for typical dynasty
  family sizes but can crowd in pathological cases. The URL toggle lets us
  compare in the field.
- **Commissioner events are not rendered.** Intentional — they're not
  part of the trade narrative — but a corner case worth noting if a
  league has unusual commissioner activity.
- **Pre-aggregation is off.** Every request recomputes from
  `asset_events`. Expected to be fine at current family sizes; will be
  revisited if P95 first-paint regresses.
- **Public endpoint.** `/api/leagues/[familyId]/graph` is unauthenticated
  by design, matching the existing `/api/leagues/[familyId]/*` pattern.
  Deep-link shares work for external recipients, which is a feature for
  share-rate measurement but a constraint if we ever want to gate content.

## Architecture

Short reference. Full plan is in
`.claude/plans/dynamic-honking-treasure.md`.

- **Route:** `src/app/(app)/league/[familyId]/graph/page.tsx`
- **API:** `src/app/api/leagues/[familyId]/graph/route.ts`
- **Types + pure transforms:** `src/lib/assetGraph.ts`
  (`buildGraphFromEvents`, `applyGraphFilters`, `focusSubgraph`,
  `computeHeaderStats`, `assetNodeId`, `managerNodeId`, `pickKey`).
- **Components:** `src/components/graph/` — `AssetGraph.tsx`, node and
  edge components, `GraphFilterSidebar.tsx`, `GraphDetailDrawer.tsx`,
  `GraphHeaderStats.tsx`, `CopyLinkButton.tsx`, `layout.ts`.
- **Flag gate:** `src/lib/featureFlags.ts` (`ASSET_GRAPH_BROWSER`) +
  `src/lib/useFlag.ts`. Entry points are gated; the page itself is not.
- **Analytics:** `src/lib/analytics.ts`.
- **Reused:** `src/lib/transactionEnrichment.ts` for edge enrichment,
  `src/lib/draft.ts` for pick resolution, `src/lib/familyResolution.ts`
  for family lookup, `src/components/TransactionCard.tsx` for drawer
  content.

Manager nodes are keyed by Sleeper `userId`, which is stable across
seasons. Pick nodes are keyed by `(leagueId, pickSeason, pickRound,
pickOriginalRosterId)` — league-scoped, because picks are league-scoped
in the schema. Never use `rosterId` for manager identity.

## Changelog

- **2026-04-16** — Experiment designed and MVP shipped behind `disabled`
  flag. Event schema frozen in `src/lib/analytics.ts`; operational metric
  definitions pinned in this document. Promotion criteria committed.
