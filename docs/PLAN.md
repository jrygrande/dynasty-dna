# Dynasty DNA — Project Plan

## Vision

Build a web application that measures dynasty fantasy football manager efficacy for Sleeper platform users. The app serves two purposes:

1. **Product**: Give dynasty managers deep, data-driven insights into their management performance — asset acquisition, lineup optimization, and trade decisions — with a product-analytics mindset borrowed from leading tech companies.
2. **Portfolio**: Demonstrate ability to build a data-intensive full-stack application with clean architecture, thoughtful data modeling, and polished UX.

## Architecture Decisions

### Decision Log

| # | Decision | Chosen | Alternatives Considered | Rationale |
|---|----------|--------|------------------------|-----------|
| 1 | Framework | Next.js 14 (App Router) | Remix, plain React+Express | SSR/SSG flexibility, API routes collocated, Vercel deployment, strong ecosystem |
| 2 | Database | Neon PostgreSQL (free tier) | Supabase, PlanetScale, SQLite | Free tier is generous, serverless Postgres, Drizzle ORM support, no cold starts via HTTP driver |
| 3 | ORM | Drizzle | Prisma, Kysely, raw SQL | Type-safe, lightweight, SQL-like API, excellent Neon integration |
| 4 | Auth | NextAuth.js v4 + GitHub OAuth | Clerk, Auth0, Supabase Auth | Free, self-hosted, flexible provider setup, JWT sessions for serverless |
| 5 | Styling | Tailwind CSS + shadcn/ui | MUI, Chakra, styled-components | Zero runtime cost, composable primitives, consistent design system |
| 6 | Data source | Sleeper API (primary) + FantasyCalc (valuations) | KeepTradeCut, custom scraping | Sleeper has a clean REST API; FantasyCalc has dynasty values |
| 7 | Deployment | Vercel | Railway, Fly.io, self-hosted | Free tier, git-push deploys, edge functions, zero config for Next.js |
| 8 | Caching strategy | Minimal DB storage + on-demand sync | Redis, full pre-cache, real-time sync | Respect Sleeper rate limits, minimize DB costs, lazy-load on first visit |
| 9 | DB driver | neon-http (serverless) | neon-websocket, pg | No persistent connections needed, works in edge/serverless, lower latency for simple queries |

### Tradeoffs Acknowledged

- **No Redis/caching layer**: Simplifies infrastructure but means repeat API calls to Sleeper if DB data is stale. Mitigated by on-demand sync with timestamps.
- **JWT sessions (not DB sessions)**: Faster auth checks, no session table queries, but can't revoke sessions server-side. Acceptable for this use case.
- **Lazy sync on first league visit**: Users wait a few seconds on first load, but avoids background job infrastructure and unnecessary API calls for leagues they never visit.
- **Free tier constraints**: Neon free tier has 0.5 GB storage and 190 compute hours/month. We store only structured data (no blobs), which should stay well under limits.

## Data Model

### Core Concepts

- **League Family**: A dynasty league spanning multiple seasons. Each season in Sleeper has its own `league_id`, linked via `previous_league_id`. We group these into a "family."
- **Manager**: A Sleeper user who participates in one or more leagues. Identified by `sleeper_user_id`.
- **Asset**: Either a **player** or a **draft pick**. Assets flow between managers via transactions.
- **Transaction**: A trade, waiver claim, free agent add, or draft selection that moves assets between managers.
- **Asset Event**: A denormalized record of every asset movement, enabling graph traversal across league history.

### External Data Sources

| Source | Data | Endpoint Pattern | Rate Limits |
|--------|------|-----------------|-------------|
| Sleeper API | Leagues, rosters, users, transactions, drafts, matchups, NFL state, players | `api.sleeper.app/v1/...` | Undocumented; ~100 req/min appears safe |
| FantasyCalc | Dynasty player valuations & rankings | `fantasycalc.com/api/...` | TBD — may need scraping fallback |
| nflverse (GitHub) | Weekly roster status, injuries, schedule, player ID crosswalk | GitHub CSV releases | None (static files) |

#### nflverse Data Details

| Dataset | URL | Key Columns | Notes |
|---------|-----|-------------|-------|
| Weekly Rosters | `nflverse-data/releases/.../roster_weekly_{season}.csv` | `gsis_id`, `sleeper_id`, `status`, `team`, `full_name` + 30 more | Primary source for NFL roster status; contains `sleeper_id` for player ID crosswalk |
| Injuries | `nflverse-data/releases/.../injuries_{season}.csv` | `gsis_id`, `report_status`, `practice_status`, injury details | Only has `gsis_id` (no `sleeper_id`) — requires crosswalk from roster data |
| Schedule | `nfldata/raw/master/data/games.csv` | `season`, `week`, `home_team`, `away_team`, scores | All-seasons file; filter to `game_type=REG` for bye week derivation |

**Player ID crosswalk**: Sleeper's API often returns `gsis_id: null`. The nflverse weekly roster CSV provides both `sleeper_id` and `gsis_id`, enabling automatic backfill during roster sync. This is self-healing — each sync fills in any missing `gsis_id` values.

## Feature Roadmap

### Phase 1: Foundation (Current) ✅
- [x] Project setup (Next.js, Drizzle, Neon, Tailwind)
- [x] GitHub OAuth authentication
- [x] Sleeper account linking (username → user_id)
- [x] League discovery (find all leagues for a Sleeper user)
- [x] League family stitching (chain `previous_league_id` across seasons)
- [x] On-demand league sync from Sleeper API
- [x] League overview page with standings
- [x] Database schema for auth, leagues, rosters, drafts, transactions, matchups, player scores

### Phase 2: Data Foundation ✅
- [x] Historical league sync (sync all seasons in a family, not just current)
- [x] Player data sync (bulk player metadata from Sleeper)
- [x] Draft history visualization (who was drafted, by whom, which pick)
- [x] Transaction log per league (trades, waivers, FA, with all assets involved)
- [x] Asset event pipeline (denormalize transactions into per-asset movement records)
- [x] Draft pick lineage tracking (pick → player → traded for picks → those picks draft players)

### Phase 3: NFL Data & Player Insights ✅
- [x] NFL weekly roster status sync from nflverse (ACT/RES/INA/DEV/CUT per player per week)
- [x] NFL injury data sync from nflverse (report status, practice status, injury details)
- [x] NFL schedule sync from nflverse (regular season games for bye week derivation)
- [x] Player ID crosswalk: backfill `gsis_id` from nflverse `sleeper_id→gsis_id` mapping (self-healing on every sync)
- [x] Fixed nflverse schedule URL (`schedules/schedules.csv` → `nfldata/games.csv`)
- [x] Player detail page with weekly log (manager, started/benched, lineup slot, NFL status, points)
- [x] Bye week detection derived from `nfl_schedule` (team not playing = bye)
- [x] Mid-season trade handling for bye weeks (uses per-week team from roster status, not current team)
- [x] Clickable player names on transactions and drafts pages (link to player detail)
- [x] Combinable filters on player detail page (season, manager, started/benched)
- [x] Summary stats on player detail page (weeks rostered, started, benched, PPG)

### Phase 4: Manager Analytics
- [ ] Lineup optimization score (actual vs. optimal lineup per week)
- [ ] Trade grading (value at trade time vs. value N days/season later)
- [ ] Draft grading (pick value vs. player performance)
- [ ] Waiver/FA acquisition scoring
- [ ] Manager DNA profile (composite score across all dimensions)
- [ ] League-wide manager leaderboard with historical rankings

### Phase 5: Asset Graph & Advanced Exploration
- [ ] Transaction detail page (all assets in a trade, linked to other transactions)
- [ ] Asset graph browser (navigate the web of trades/picks/players)
- [ ] "What if" counterfactual analysis (what if you hadn't made that trade?)

### Phase 6: Polish & Advanced Features
- [ ] FantasyCalc integration for forward-looking valuations
- [ ] Responsive mobile design
- [ ] League comparison (how does your league's activity compare to others?)
- [ ] Export/share manager DNA profiles
- [ ] Production deployment hardening (error handling, loading states, edge cases)

## Manager Scoring Philosophy

We evaluate managers across four dimensions, inspired by how product analytics teams think about user behavior:

### 1. Asset Acquisition (How well do you get players?)
- **Draft**: Did you pick players who outperformed their draft slot?
- **Trade**: Did you acquire assets whose value increased after the trade?
- **Waivers/FA**: Did you find breakout players on the wire?

### 2. Asset Divestment (How well do you sell?)
- Did you trade away players at peak value (before decline)?
- Did you avoid holding depreciating assets too long?

### 3. Lineup Optimization (Do you start the right players?)
- What % of weeks did you set the optimal lineup?
- How many points did you leave on the bench?

### 4. Overall DNA Score
- Weighted composite of the above, with percentile ranking within the league.
- Historical tracking: how has a manager's DNA evolved over seasons?

## Technical Principles

1. **Respect external APIs**: Cache aggressively, sync lazily, never hammer Sleeper.
2. **Type safety everywhere**: Drizzle schema is the source of truth; TypeScript catches mismatches at compile time.
3. **Progressive data loading**: Show what we have immediately, sync missing data in the background.
4. **Minimal storage**: Store only what we can't re-derive from Sleeper. Computed analytics go in dedicated tables.
5. **Debuggable**: Every sync operation should be traceable. Log decisions, not just actions.
