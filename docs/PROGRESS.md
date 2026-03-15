# Dynasty DNA — Progress Log

## 2026-03-15: Fresh Start — Foundation Complete

### What was accomplished

**Full rebuild from scratch** on a new branch (`claude/condescending-shannon`), keeping only the project name and repo.

#### Infrastructure
- Set up Next.js 14 (App Router) with TypeScript, Tailwind CSS
- Connected to Neon PostgreSQL (free tier) via Drizzle ORM with `neon-http` serverless driver
- Deployed database schema: 20+ tables covering auth, leagues, rosters, players, transactions, drafts, matchups, analytics
- Configured Vercel deployment pipeline (`vercel.json`, `.vercelignore`)

#### Authentication
- Implemented NextAuth.js v4 with GitHub OAuth provider
- JWT session strategy (no DB sessions needed for serverless)
- Drizzle adapter with explicit table mappings for NextAuth compatibility
- Fixed schema column naming (NextAuth adapter requires camelCase DB columns for `userId`, `sessionToken`, etc.)
- Fixed user ID generation (`$defaultFn(() => crypto.randomUUID())` for the users table)
- Google OAuth provider pre-wired (credentials not yet configured)

#### Sleeper Integration
- Built `Sleeper` API client with typed endpoints for: user lookup, leagues, rosters, users, drafts, draft picks, transactions, matchups, traded picks, NFL state
- Sleeper account linking flow: user enters Sleeper username → validated against Sleeper API → stored in `sleeper_links` table
- League discovery: fetches all leagues for a Sleeper user across last 3 seasons, groups into "families" by tracing `previous_league_id` chains

#### Data Sync Pipeline
- On-demand league sync: fetches league info, users, rosters, drafts, draft picks, traded picks, transactions (all weeks), matchups with player scores
- Upsert-based sync (idempotent, safe to re-run)
- League family management: discovers full dynasty chain, creates family records, links all seasons
- Auto-sync on first league visit (no manual "sync" button needed for initial load)

#### UI Pages
- **Landing page** (`/`): Sign in with Google/GitHub buttons, tagline, clean design
- **Dashboard** (`/dashboard`): Shows linked Sleeper account, lists all league families with dynasty badges and season ranges
- **League overview** (`/league/[familyId]`): Standings table with W/L/PF/PA, season selector pills, manager links, sync button

### Bugs fixed
- NextAuth `Callback` error: Schema column names used snake_case but Drizzle adapter expected camelCase
- NextAuth `OAuthCreateAccount` error: Users table `id` column had no default value generator
- League route `string_to_uuid` crash: Route tried to query UUID column with Sleeper's numeric league IDs; added UUID format validation
- League `404` after successful sync: Drizzle `getDb()` singleton was lost across Next.js hot reloads; fixed with `globalThis` persistence pattern
- League not auto-syncing: Added auto-sync trigger when league page gets 404, with "Syncing league data from Sleeper..." loading state

### Key decisions made
- **Neon over Supabase**: Both are free, but Neon's serverless HTTP driver (`@neondatabase/serverless`) works cleanly with Drizzle and Vercel Edge. Supabase adds its own auth/API layer we don't need.
- **JWT over DB sessions**: Eliminates a DB query on every request. We don't need server-side session revocation.
- **Lazy sync over eager pre-fetch**: Users only wait for sync on their first league visit. Avoids unnecessary API calls to Sleeper for leagues they never open.
- **Single branch rebuild**: The old codebase had accumulated technical debt (Docker, Redis, complex sync middleware, 100+ files of tangled code). Starting fresh with a clear architecture was faster than refactoring.

### What's next (Phase 2)
- Sync all historical seasons in a league family (currently only syncs the current season's data)
- Player metadata sync (names, positions, teams)
- Transaction log page with full asset details
- Draft history visualization
- Asset event denormalization pipeline

## 2026-03-15: Phase 2 — Data Foundation Complete

### What was accomplished

**Full data foundation** enabling historical league analysis, player name resolution, browsable transactions and drafts, and the asset event pipeline that powers future analytics.

#### Step 1: Player Data Sync
- Created `src/services/playerSync.ts` — bulk sync of all fantasy-relevant NFL players from Sleeper's `/players/nfl` endpoint
- Filters to QB/RB/WR/TE/K/DEF positions, batch-upserts (50 per batch) into `players` table
- 24-hour staleness check: skips sync if data is fresh
- Wired into `syncLeague()` — player sync runs automatically at the start of any league sync
- New API endpoint: `POST /api/sync/players` (with `?force=true` option)

#### Step 2: Historical League Family Sync
- Modified `POST /api/sync/league` to sync ALL seasons in a dynasty family, not just the current one
- `syncLeagueFamily()` now skips completed seasons that were synced within the last 7 days (avoids redundant API calls)
- Leagues sorted oldest-first during sync for correct data ordering
- Added `?season=` query parameter to `GET /api/leagues/[familyId]` — returns rosters/standings for any season
- Season pills on league page are now clickable buttons — clicking loads that season's standings

#### Step 3: Asset Event Pipeline
- Created `src/services/assetEvents.ts` — the core denormalization engine
- `buildAssetEvents(leagueId, season)`: delete-and-rebuild pattern (idempotent)
- Processes all transaction types:
  - **Trades**: player adds/drops → `trade` events; draft pick movements → `pick_trade` events
  - **Waivers**: `waiver_add` and `waiver_drop` events (preserves bid amounts)
  - **Free Agents**: `free_agent_add` and `free_agent_drop` events
  - **Drafts**: each completed draft pick → `draft_selected` event with pick metadata
- Resolves `fromUserId`/`toUserId` via roster owner lookups
- Added pick lineage index on `(leagueId, pickSeason, pickRound, pickOriginalRosterId)` for efficient pick tracking
- Wired into `syncLeague()` — asset events rebuild automatically after each season sync

#### Step 4: Transaction Log UI
- New API: `GET /api/leagues/[familyId]/transactions` with filters for season, type (trade/waiver/free_agent), pagination
- Joins transactions with player names and roster owner names
- New page: `/league/[familyId]/transactions` with:
  - Season filter pills (All Seasons + individual seasons)
  - Type filter tabs (All / Trades / Waivers / Free Agents)
  - Trade cards: two-column layout showing each side's received/sent players and draft picks
  - Waiver/FA cards: simple add/drop with player names and manager names
  - Pagination for large transaction histories

#### Step 5: Draft History UI
- New API: `GET /api/leagues/[familyId]/drafts` with optional `?season=` filter
- Returns draft board data: picks with player names, positions, manager names
- New page: `/league/[familyId]/drafts` with:
  - Draft board grid (rounds x teams) showing player, position badge, and drafter
  - Position-coded badges (QB=red, RB=blue, WR=green, TE=orange, K=purple, DEF=gray)
  - Keeper indicators
  - Season filter for multi-year viewing

#### Step 6: Asset History API + Timeline Component
- New API: `GET /api/leagues/[familyId]/asset-history?playerId=X` — returns chronological asset events across all family seasons
- Also supports pick tracking: `?pickSeason=&pickRound=&pickOriginalRosterId=`
- `AssetTimeline` component: vertical timeline with color-coded event dots (Draft=blue, Trade=purple, Waiver=amber, Drop=red, FA=green)
- Shows ownership chain with manager names and dates

#### Navigation
- League page header now has "Transactions" and "Drafts" navigation links alongside "Sync Data" button

### Key decisions made
- **Delete-and-rebuild for asset events**: Rather than incremental updates, we delete all events for a league and rebuild from transactions + drafts. This is simpler, idempotent, and avoids complex diffing logic. The performance cost is negligible since it's a write-time operation, not read-time.
- **7-day staleness for completed seasons**: Completed seasons' data doesn't change on Sleeper, so we skip re-syncing them if synced within 7 days. This dramatically reduces API calls for leagues with 6+ seasons of history.
- **Player sync at league sync time**: Rather than a separate scheduled job, player metadata syncs lazily when a user visits their league. The 24-hour staleness window prevents redundant calls.

### What's next (Phase 3: Manager Analytics)
- Lineup optimization score (actual vs. optimal lineup per week)
- Trade grading (value at trade time vs. value N days/season later)
- Draft grading (pick value vs. player performance)
- Waiver/FA acquisition scoring
- Manager DNA profile (composite score across all dimensions)
- League-wide manager leaderboard with historical rankings
