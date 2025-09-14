# Dynasty‑DNA: Measuring Dynasty Manager Efficacy (Sleeper)

## 1) Product Summary
Build a web application that quantifies how effective dynasty fantasy football managers are over time by analyzing every move (draft picks, trades, waivers/FAAB, adds/drops, lineup decisions) and the downstream performance of the affected assets (players and picks). Data is sourced exclusively from the Sleeper public API. The app synthesizes historical league activity into intuitive, defensible metrics and visualizations per manager, per season, and multi‑year.

---

## 2) Goals & Non‑Goals
**Goals**
- Provide a standardized "Manager Efficacy Score" (MES) and supporting sub‑metrics (draft ROI, trade ROI, waiver ROI, lineup efficiency, value retention of future picks).
- Support any Sleeper dynasty league (multi‑year history) with custom scoring and roster settings.
- Make results explainable and auditable (click into any score to see the underlying transactions, matchups, and player outcomes).
- Delight with fast, modern UI (shadcn/ui) and exportable reports.

**Non‑Goals (v1)**
- Real‑time projections/forecasts (only realized results).
- Cross‑platform ingestion (ESPN/Yahoo/MFL) — future.
- True market value modeling beyond information available from Sleeper (e.g., external ADP/values) — future optional add‑ins.

---

## 3) Personas & JTBD
**Commissioner Casey** — wants impartial awards and history pages; JTBD: “Show manager outcomes by season and all‑time.”
**Trader Taylor** — wants to validate trading skill; JTBD: “Did I win my trades over the next 4–16 weeks and season?”
**Historian Harper** — wants a league almanac; JTBD: “See timelines of big moves and their consequences.”

---

## 4) Success Metrics (KPIs)
- **Activation**: % of new leagues with ≥3 seasons backfilled and ≥8 managers visiting their page in 7 days.
- **Insight Depth**: Avg. drill‑downs per session (>4).
- **Trust**: Error rate of data discrepancies reported (<0.5% of leagues) + time‑to‑recompute (<10 min after resync).
- **Engagement**: Monthly returning leagues (>40%).

---

## 5) Scope
### MVP (4–6 weeks of focused build)
- League onboarding by username or league_id.
- Historical backfill for: league settings, rosters, users, drafts, traded picks, **transactions**, **weekly matchups**, **players**.
- Baseline metrics: Draft ROI, Trade ROI, Waiver ROI, Lineup Efficiency, Pick Value Retention, Overall MES.
- Manager and League dashboards (table + charts) with filters (season, week, metric).
- Transparent audit views for any calculation.

### v1.1+ Enhancements
- Multi‑league portfolio view for users in several leagues.
- Head‑to‑head manager comparisons.
- Export (PDF/CSV) and sharable permalinks.
- Scheduled syncs + light Slack/Discord webhooks.

---

## 6) Data Model & Ingestion
**Core Entities**
- `User` (Sleeper user_id, username, display_name)
- `League` (id, name, season, previous_league_id, scoring settings, roster positions)
- `Roster` (league_id, roster_id, owner_id, starters, bench)
- `Player` (player_id, name, position, team, status)
- `Matchup` (league_id, week, roster_id, starters, players, points)
- `Transaction` (league_id, week, type=trade|waiver|free_agent|commissioner, adds, drops, faab, draft_picks moved)
- `Draft` (draft_id, league_id, season, settings)
- `DraftPick` (draft_id, pick_no, roster_id, player_id, round, traded_from?, is_keeper?)
- `TradedPick` (league_id, season, round, roster_id (original), owner_id (current))
- `MetricSnapshot` (league_id, manager_id, week/season scope, metric_name, value, metadata)

**Ingestion Workflow**
1) Resolve **user → leagues** across seasons (follow `previous_league_id`).
2) For each league_id, fetch: league settings, rosters, users, matchups per week, transactions per week, traded picks, drafts+picks; hydrate player library.
3) Normalize and store; compute derived tables (e.g., per‑player weekly points on roster vs bench, transaction deltas, pick lineage map).
4) Recompute when:
   - new week is available;
   - league settings change;
   - backfill gap detected.

**Sync Strategy**
- Initial backfill: breadth‑first by seasons → weeks → heavy endpoints (transactions, matchups).
- Ongoing: poll league `state` weekly in‑season; throttle by league.
- Cache player library and league metadata; diffing to avoid re‑processing.

---

## 7) Metric Definitions (First Principles)
> All metrics are **league‑settings aware** (PPR, bonuses, lineup slots). All values are computed in **points above replacement (PAR)** terms when possible to normalize positions; when not, raw points with positional context are shown.

### 7.1 Manager Efficacy Score (MES)
Weighted composite of standardized sub‑metrics for a manager in a given season:
- **Trade ROI (35%)**
- **Draft ROI (25%)**
- **Waiver/FAAB ROI (20%)**
- **Lineup Efficiency (15%)**
- **Pick Value Retention (5%)**
Weights are tunable in admin; defaults above.

### 7.2 Trade ROI
For each trade (week t):
- Identify assets moved (players and picks). For picks, map to realized players once drafted; before realization, track as expected value placeholder (displayed separately as *unrealized*).
- Compute **post‑trade delta** in cumulative points contributed to each manager from t+1 to end of season (and optionally 4‑week, 8‑week windows). Attribute to trade.
- Adjust for lineup reality: only count **started** points; show bench‑aware alternate view.
- Summation across trades → season Trade ROI.

### 7.3 Draft ROI
For each drafted player: points contributed in year N and N+1 vs round‑adjusted baseline (league‑specific). Baseline = median points for that round & position within the league (or all leagues, if we later add cross‑league baselines). Draft ROI = sum of (player_points − baseline).

### 7.4 Waiver/FAAB ROI
For each add/drop or waiver claim: points contributed while on roster minus (optional) opportunity cost (player dropped). FAAB efficiency = points per FAAB dollar.

### 7.5 Lineup Efficiency
Per week: `actual_points_started / max(points from any legal lineup)`; season efficiency = average (or sum of lost points).

### 7.6 Pick Value Retention
For future picks held/traded: track chain of custody and realized returns post‑draft versus league’s average for that pick slot.

**Auditability**: Every metric is clickable to a transaction/matchup list with timestamps and exact calculations.

---

## 8) Architecture & Tech Choices
### 8.1 Frontend
- **Next.js (App Router) + TypeScript**
- **UI**: Tailwind + **shadcn/ui** components; Radix primitives.
- **Data Fetching**: TanStack Query; optimistic UI for resyncs.
- **Charts**: Recharts (performance, stacked bars for ROI composition).
- **Auth**: Email‑magic‑link (Clerk/Auth.js) + optional “public league” mode by slug.
- **Deployment**: Vercel.

### 8.2 Backend
**Option A (Monolith, recommended to start)**
- Next.js API routes (Edge/Node) with **Drizzle ORM** → **PostgreSQL (Neon/Supabase)**.
- Background jobs with **BullMQ + Upstash Redis** (or Vercel Cron + durable queues) for backfills and scheduled syncs.

**Option B (Services)**
- **FastAPI** (Python) or **NestJS** (Node) service for ingestion/compute; Next.js as pure frontend. Same Postgres/Redis.

**Why A first**: Faster iteration, one repo, easy Vercel deploy; when compute needs exceed serverless limits, graduate heavy jobs to a worker service.

### 8.3 Data & Caching
- Postgres schema (see §6) with composite indexes on `(league_id, week)`, JSONB for transaction payloads.
- Redis layer for hot league pages and player dictionary.
- S3/GCS for static exports.

### 8.4 Reliability, Rate‑Limiting & Etiquette
- Global request limiter (~<1000 req/min per IP), per‑league concurrency caps, exponential backoff.
- Idempotent ingestion keyed by `(league_id, week, endpoint, etag)`.
- Observability: structured logs, traces, job dashboards, data freshness badges in UI.

---

## 9) Sleeper API Coverage Map → Our Pipelines
- **User**: get by username or id → discover leagues.
- **Leagues**: league details; **rosters**, **users**, **matchups** per `week`, **playoff bracket**.
- **Transactions** (per week): trades, waivers, free agent adds/drops → unify into `Transaction` rows with asset diffs.
- **Traded Picks** (league‑level): future pick ownership map.
- **Drafts & Picks**: draft board, picks, traded picks → link picks to players.
- **Players**: full player dictionary.
- **State (NFL)**: current `season`/`week` for scheduling.

---

## 10) UX & IA (shadcn/ui)
**Key Screens**
1) **League Overview** — season selector, MES leaderboard, sparkline trends.
2) **Manager Profile** — composite gauge, sub‑metric cards, timeline of moves.
3) **Trade Analyzer** — table of trades with realized/unrealized ROI and drill‑downs.
4) **Draft Room Recap** — board, pick values, round ROI heatmap.
5) **Waiver Ledger** — FAAB spend vs return charts.
6) **Lineup Coach** — weekly efficiency chart with “lost points” explanations.

**Components**: Cards, DataTable, Dialogs, Tabs, Accordion, Tooltip, Skeletons, Command Menu (⌘K), Toaster.

**Empty‑state copy** and **loading skeletons** for a polished feel.

---

## 11) Implementation Plan (Milestones)
**M0 — Project Setup (0.5w)**
- Next.js app, Tailwind, shadcn/ui init; Drizzle + Postgres; basic auth; design tokens.

**M1 — Ingestion Foundations (1.5w)**
- Sleeper client module; rate limiter; player dictionary cache.
- Entities & migrations; seed + test harness.

**M2 — League Sync & Backfill (1.5w)**
- User → leagues traversal across `previous_league_id`.
- League normalization; rosters, users, matchups (loop weeks), transactions, drafts, traded picks.
- Job orchestration + retries + progress UI.

**M3 — Metrics Engine (1.5w)**
- Transaction delta pipeline (per asset → points while rostered after event).
- Lineup optimizer (weekly max points) using roster slots rules; efficiency calc.
- Draft/waiver ROI baselines; MES roll‑up + audit trails.

**M4 — UI Dashboards (1w)**
- League Overview, Manager Profile, Trade Analyzer with drill‑downs, export (CSV/PDF).

**M5 — Polish & Beta (0.5w)**
- Perf passes, caching, guardrails, telemetry, help docs.

---

## 12) Risks & Mitigations
- **API Changes/Rate Limits**: defensive client, config gates, retry/backoff, job queue.
- **League Variability**: normalize by reading league scoring/roster settings; store per‑league baselines.
- **Attribution Ambiguity**: make rules explicit (started vs bench points, realization windows) and let users toggle; always show audit trails.

---

## 13) Testing Strategy
- Unit tests for mappers, calculators (golden files).
- Contract tests against canned Sleeper fixtures.
- E2E: ingest a known public league → validate metrics tables.

---

## 14) Analytics & Telemetry
- Eventing: ingestion job states, page views, drill‑downs, export usage.
- Privacy: no PII beyond Sleeper public data and user login.

---

## 15) Deployment & Ops
- Envs: Preview (PR), Staging, Prod.
- GitHub Actions CI (typecheck, lint, test, DB migrations).
- Cron schedules for in‑season weekly sync; manual resync button.

---

## 16) Open Questions (Assumptions for now)
- Weighting of MES — default as above, but add sliders later.
- Handling unrealized pick value — display separately until pick becomes a player.
- Cross‑season manager continuity when owners change mid‑season — display splits; attribute pre/post to different owners.

---

## 17) Appendix: Calculation Details
- **PAR Baseline**: compute positional replacement as median starter at each position/slot for the league that week/season.
- **Trade windows**: default season‑to‑date after trade; provide 4‑week/8‑week toggle.
- **Lineup max**: brute‑force or integer programming limited by roster slots (fallback greedy heuristic if necessary; accept ~98–100% optimal).

---

## 18) Next Steps (You & Me)
1) Share one target league_id and desired seasons.
2) I’ll generate the schema & ingestion scaffolding.
3) We run a backfill and validate metrics on that real league.


---

## 18) Feature 1 — **Asset Timelines** (MVP for a Single League, Free Stack)

### 18.1 Problem & Constraints (from your notes)
- In Sleeper, a `league_id` maps to a **single season**; chain seasons through `previous_league_id` to form the multi‑year "league" concept.
- **Untraded future draft picks** (the default 4 rookie picks each manager receives for year N+3) are **not surfaced** on rosters/transactions. Tracking their ownership over time is crucial.
- You want **draft selections modeled like transactions**: a manager "drops" a pick and "adds" a player at the moment of selection.
- First feature: **search any asset (player or draft pick)** → show a **timeline** of events (provisioned, traded, drafted, added/dropped) + **usage** (PPG, start rate) between events. Trades should be explorable with all bundled assets; clicking any asset adds its timeline to the page.

### 18.2 Free‑First, Extensible Tech Plan
**Start free, keep the upgrade path simple**:
- **Hosting:** Vercel (Free) for Next.js (app + API routes).
- **DB (dev/single‑league):** **SQLite** (file) via **Drizzle ORM**; zero cost, trivial to set up.
- **DB (scale path):** Migrate Drizzle to **Postgres (Neon/Supabase Free)** with the same schema. Keep SQL portable.
- **Jobs/Cron:** Vercel Cron (Free) + simple `job_runs` table. For single‑league, avoid Redis.
- **Caching:** In‑memory + HTTP; add Redis later if needed.
- **Auth:** NextAuth Email (passwordless) or skip for local dev.

> Migration path: flip Drizzle connection from SQLite to Postgres, run the same migrations, then (optionally) add a worker and Redis for multi‑league scale.

### 18.3 Domain Model Additions (to handle untraded picks & timelines)
**New/Adjusted Tables** (SQLite → Postgres‑safe):
- `LeagueSeason` (id: sleeper_league_id, season_year, previous_league_id, name, settings_json)
- `LeagueChain` (chain_id, root_league_id) — 1 row per multi‑year league; maps seasons via follow‑links
- `Roster` (league_season_id, roster_id, owner_user_id)
- `User` (sleeper_user_id, username, display_name)
- `Player` (player_id, name, pos, team)
- `Matchup` (league_season_id, week, roster_id, starters_json, players_json, points)
- `Transaction` (id, league_season_id, week, type: trade|waiver|faab|draft|drop|add, payload_json, created_at)
- `Draft` (draft_id, league_season_id, type, rounds, settings_json)
- `DraftPickAsset` (**primary key**: `asset_id` = `${season}-${round}-${original_roster_id}`; season, round, original_roster_id, current_owner_roster_id, status: provisioned|traded|spent|expired, realized_player_id NULL, realized_draft_id NULL, slot NULL INT)
- `AssetEvent` (id, **asset_type**: player|pick, **asset_ref**: player_id|asset_id, ts, league_season_id, week NULL, kind: provisioned|trade_in|trade_out|draft_spent|add|drop|start|bench, counterparty NULL, transaction_id NULL, details_json)
- `OwnershipSpan` (asset_type, asset_ref, owner_roster_id, start_ts, end_ts NULL)
- `Metric_PlayerUsage` (player_id, owner_roster_id, season_year, week, started_bool, points)

**Notes**
- `DraftPickAsset` makes **untraded default picks** first‑class from the moment they are **provisioned**.
- `OwnershipSpan` enables PPG and start‑rate calculations **between events** without heavy recompute.
- `AssetEvent` is the single source for timelines; the UI is a query over events ordered by `ts`.

### 18.4 Algorithms & Data Flow
**A) Build the League Chain**
1. Given any season `league_id`, follow `previous_league_id` until NULL → ordered seasons (oldest → newest).
2. Insert `LeagueSeason` rows; derive one `LeagueChain` id.

**B) Seed Untraded Picks (Provisioning)**
For each completed draft in season **Y** (rookie draft):
1. Identify **N rosters** present right after the draft.
2. For each roster, **provision 4 picks** for season **Y+3**: rounds 1..4.
3. Create `DraftPickAsset` rows with `original_roster_id = roster_id` and `current_owner_roster_id = same`.
4. Add `AssetEvent(kind='provisioned')` at timestamp = end of draft. `slot` will be **NULL** until season **Y+2** standings finalize; then set 1..N.

**C) Resolve Ownership Over Time**
- Consume `league/<id>/traded_picks` and weekly `transactions/<week>` to capture pick trades. Update `current_owner_roster_id` and emit paired `AssetEvent` records referencing a `Transaction` row.
- Picks that never trade simply persist with the original owner until draft.

**D) Realize Picks at Draft (Selection as Transaction)**
At the rookie draft for season **Y+3**:
1. Iterate the **draft board**. For each selection:
   - Map to the corresponding `DraftPickAsset` (by season/round/slot or by original owner when slotless → resolve once slot known).
   - Create `Transaction(type='draft')` with payload `{drop_pick: asset_id, add_player: player_id, roster_id}`.
   - Mark pick `status='spent'`, set `realized_player_id`, `realized_draft_id`, and emit `AssetEvent(kind='draft_spent')` + `AssetEvent(kind='add')` for the player.

**E) Player Usage Between Events**
- From `matchups`, compute per player per roster per week: `started_bool`, `points`.
- Materialize `Metric_PlayerUsage` and maintain `OwnershipSpan` (start on add/trade_in/draft_spent; end on drop/trade_out).
- For any timeline segment (between adjacent events), compute **PPG** and **start rate** via filtered `Metric_PlayerUsage`.

**F) API for Feature 1**
- `GET /api/assets/search?q=` → mixed typeahead results (players + picks). For picks, support queries like "2027 1st" or "2027 2.03" or "Team X 2027 3rd".
- `GET /api/assets/player/:player_id/timeline?chain_id=` → events + derived spans.
- `GET /api/assets/pick/:asset_id/timeline?chain_id=` → same shape.
- `GET /api/transactions/:id` → normalized trade/draft with linked assets.

**G) UI/UX (shadcn/ui)**
- **Search (Command/Dialog)** for asset lookup.
- **Timeline Canvas** using Cards + Badge + Tooltip + Tabs: event cards for Provisioned, Trade, Draft, Add/Drop; each segment shows PPG & start‑rate chips. “Add to Compare” pins another timeline beside it.
- **Trade Drawer** shows all assets in the transaction with quick‑add timeline buttons.

**H) Edge Cases**
- League expansion/contraction: provision picks to rosters present **post‑draft Y**; reconcile mapping to Y+3 via manager `user_id` continuity.
- Slot resolution occurs after **Y+2** standings; until then, picks render as "2027 1st (Team X)"; later they also display slot (e.g., 1.07).
- Mid‑season owner change: events remain roster‑scoped; manager views join by `User` tenure periods.

### 18.5 Minimal Dev Backlog (Week 1)
1) Bootstrap (Next.js, Drizzle, SQLite, shadcn) + migrations for **LeagueChain/Season, Roster, Player**.
2) League chain ingestion for a single `league_id`.
3) Player dictionary + weekly matchups ingest.
4) Draft discovery + **provisioning job** (create Y+3 `DraftPickAsset` + `provisioned` events).
5) Transaction normalizer (trade/waiver/add/drop) → `Transaction` + `AssetEvent`.
6) Draft selection mapping → `draft` transactions + pick realization.
7) `OwnershipSpan` builder + `Metric_PlayerUsage`.
8) `/api/assets/search` + `/timeline` endpoints.
9) UI: search → display timeline; add compare timeline.

### 18.6 Validation Checklist
- Idle pick: Provisioned → Draft Spent (→ player timeline continues).
- Multi‑trade pick: Provisioned → Trade → Trade → Draft Spent (final owner spends).
- Player traded then benched: usage segments show PPG/start‑rate shifts.

---

## 19) Next Steps (Actionable)
1) Share **one Sleeper `league_id`** (entry season). I’ll chain seasons automatically.
2) I’ll generate the initial **SQLite schema + Drizzle migrations** and stubs for `/api/assets/*`.
3) Run a local backfill and validate three happy‑path timelines (1 player, 1 idle pick, 1 multi‑trade pick).


---

## 20) League 1191596293294166016 — Startup vs Rookie Draft Handling

**Input**: Entry season `league_id = 1191596293294166016` (2025). League began in 2021 with a **startup** snake draft; subsequent years have **rookie** linear 4‑round drafts. Rookie draft order is derived from prior season finish. Treat all **selections** as transactions (pick → player) for timeline purposes.

### 20.1 Detection of Draft Type (per Sleeper Draft)
- Prefer explicit fields from Sleeper (`draft.type`, `draft.settings.slot_type`, etc.) when available.
- Fallback inference:
  - **Startup** if: (a) `type === 'snake'` **or** (b) rounds >> 4 and majority of players are veterans.
  - **Rookie** if: (a) `type === 'linear'` and `rounds === 4` **or** roster sizes are unchanged and players are predominantly rookies.

We store `draft_kind = 'startup' | 'rookie'` in `Draft` and drive provisioning logic from it.

### 20.2 Provisioning Rules for Untraded Future Picks
- **Do not provision** Y+3 picks after a **startup** draft (2021). That draft fills rosters; rookie pick provisioning begins with the **first rookie draft**, i.e., **2022**.
- For each rookie draft in season **Y**: provision 4 picks per active roster for **season Y+3** (rounds 1..4) and emit `AssetEvent(kind='provisioned')` at the end‑of‑draft timestamp. Slots remain NULL until **Y+2** standings finalize.

### 20.3 Ingestion Runbook for This League
1) **Chain Seasons**: starting from 2025 league_id, follow `previous_league_id` to collect 2024 → 2021.
2) **Users/Rosters**: ingest users & rosters for each season; map owner continuity by `user_id`.
3) **Drafts & Picks**:
   - Identify each season’s draft(s); classify **startup (2021)** vs **rookie (2022–2025)**.
   - For rookie drafts (2022–2025): emit **draft selection transactions** (pick spent → player added) and then run **provisioning** for Y+3.
   - For 2021 startup: emit selection transactions only; **no provisioning**.
4) **Transactions**: weekly `transactions/<week>` to capture trades, waivers, fas; normalize to `Transaction` + paired `AssetEvent`.
5) **Traded Picks**: `traded_picks` endpoint to adjust pick ownership; use alongside weekly trade payloads.
6) **Matchups**: ingest per week for lineup usage & points; build `Metric_PlayerUsage` and `OwnershipSpan`.
7) **Timelines**: enable `/api/assets/*` for player/pick timelines; verify three scenarios (idle pick, multi‑trade pick, traded player with usage deltas).

### 20.4 Drizzle Schema (TypeScript, SQLite‑first)
```ts
// drizzle/schema.ts (excerpt)
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const leagueChain = sqliteTable('league_chain', {
  chainId: text('chain_id').primaryKey(),
  rootLeagueId: text('root_league_id').notNull(),
});

export const leagueSeason = sqliteTable('league_season', {
  leagueId: text('league_id').primaryKey(), // Sleeper season league_id
  chainId: text('chain_id').notNull(),
  seasonYear: integer('season_year').notNull(),
  previousLeagueId: text('previous_league_id'),
  name: text('name'),
  settingsJson: text('settings_json'),
});

export const roster = sqliteTable('roster', {
  leagueId: text('league_id').notNull(),
  rosterId: integer('roster_id').notNull(),
  ownerUserId: text('owner_user_id'),
}, (t) => ({ pk: primaryKey({ columns: [t.leagueId, t.rosterId] }) }));

export const user = sqliteTable('user', {
  userId: text('user_id').primaryKey(),
  username: text('username'),
  displayName: text('display_name'),
});

export const player = sqliteTable('player', {
  playerId: text('player_id').primaryKey(),
  name: text('name'),
  pos: text('pos'),
  team: text('team'),
});

export const draft = sqliteTable('draft', {
  draftId: text('draft_id').primaryKey(),
  leagueId: text('league_id').notNull(),
  kind: text('kind').notNull(), // 'startup' | 'rookie'
  rounds: integer('rounds').notNull(),
  settingsJson: text('settings_json'),
});

export const transaction = sqliteTable('transaction', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull(),
  week: integer('week'),
  type: text('type').notNull(), // 'trade'|'waiver'|'faab'|'draft'|'add'|'drop'
  payloadJson: text('payload_json'),
  createdAt: integer('created_at'), // epoch seconds
});

export const draftPickAsset = sqliteTable('draft_pick_asset', {
  assetId: text('asset_id').primaryKey(), // `${season}-${round}-${original_roster_id}` initially
  season: integer('season').notNull(), // draft season the pick belongs to
  round: integer('round').notNull(),
  slot: integer('slot'), // 1..N once known
  originalRosterId: integer('original_roster_id').notNull(),
  currentOwnerRosterId: integer('current_owner_roster_id').notNull(),
  status: text('status').notNull(), // 'provisioned'|'traded'|'spent'|'expired'
  realizedPlayerId: text('realized_player_id'),
  realizedDraftId: text('realized_draft_id'),
});

export const assetEvent = sqliteTable('asset_event', {
  id: text('id').primaryKey(),
  assetType: text('asset_type').notNull(), // 'player'|'pick'
  assetRef: text('asset_ref').notNull(), // player_id or asset_id
  ts: integer('ts').notNull(),
  leagueId: text('league_id'),
  week: integer('week'),
  kind: text('kind').notNull(), // 'provisioned'|'trade_in'|'trade_out'|'draft_spent'|'add'|'drop'|'start'|'bench'
  counterparty: text('counterparty'),
  transactionId: text('transaction_id'),
  detailsJson: text('details_json'),
});

export const ownershipSpan = sqliteTable('ownership_span', {
  assetType: text('asset_type').notNull(),
  assetRef: text('asset_ref').notNull(),
  ownerRosterId: integer('owner_roster_id').notNull(),
  startTs: integer('start_ts').notNull(),
  endTs: integer('end_ts'),
}, (t) => ({ pk: primaryKey({ columns: [t.assetType, t.assetRef, t.ownerRosterId, t.startTs] }) }));

export const metricPlayerUsage = sqliteTable('metric_player_usage', {
  playerId: text('player_id').notNull(),
  ownerRosterId: integer('owner_roster_id').notNull(),
  seasonYear: integer('season_year').notNull(),
  week: integer('week').notNull(),
  started: integer('started', { mode: 'boolean' }).notNull(),
  points: integer('points').notNull(), // store as INT * 100 if you want fixed‑point
}, (t) => ({ pk: primaryKey({ columns: [t.playerId, t.ownerRosterId, t.seasonYear, t.week] }) }));
```

### 20.5 Ingestion Pseudocode (startup/rookie aware)
```ts
async function ingestLeagueChain(entryLeagueId: string) {
  const chain = await followPreviousLeagueIds(entryLeagueId); // [2021..2025]
  for (const leagueId of chain) {
    await upsertLeagueSeason(leagueId);
    await ingestUsersAndRosters(leagueId);
    const drafts = await getDrafts(leagueId);
    for (const d of drafts) {
      const kind = classifyDraft(d);
      await upsertDraft({ ...d, kind });
      await emitDraftSelectionTransactions(d, kind); // add Transaction + AssetEvent(draft_spent/add)
      if (kind === 'rookie') {
        await provisionYPlus3Picks(d); // create DraftPickAsset + provisioned events
      }
    }
    await ingestWeeklyTransactions(leagueId); // trades/waivers → Transaction + AssetEvent
    await ingestTradedPicks(leagueId); // adjust currentOwnerRosterId + trade events
    await ingestMatchups(leagueId); // build Metric_PlayerUsage; update OwnershipSpan
  }
}
```

### 20.6 API Stubs (Next.js App Router)
```ts
// app/api/assets/search/route.ts
export async function GET(req: Request) { /* q -> players + picks */ }

// app/api/assets/player/[playerId]/timeline/route.ts
export async function GET(_req: Request, { params }: { params: { playerId: string }}) { /* return events + spans */ }

// app/api/assets/pick/[assetId]/timeline/route.ts
export async function GET(_req: Request, { params }: { params: { assetId: string }}) { /* return events + spans */ }

// app/api/transactions/[id]/route.ts
export async function GET(_req: Request, { params }: { params: { id: string }}) { /* normalized trade/draft */ }

// app/api/ingest/[leagueId]/route.ts  // one‑click backfill for this chain
export async function POST(_req: Request, { params }: { params: { leagueId: string }}) { /* run ingestLeagueChain */ }
```

### 20.7 UI Note for Startup Draft (2021)
- Timeline cards label the 2021 draft as **Startup Draft** with a snake‑order badge; rookie drafts get a **Rookie Draft** badge (Linear). Both produce the same **Draft Selection** transaction cards so timelines remain consistent.

### 20.8 QA Cases Specific to This League
- 2021 startup: verify no Y+3 provisioning occurs and that selection transactions create player timelines from day 0.
- 2022 rookie: provisioning for **2025** picks after the draft; ensure picks exist and, by 2024 standings, slots resolve for **2025**.
- 2023 rookie: provisioning for **2026**; 2024 rookie → **2027**; 2025 rookie → **2028**.

