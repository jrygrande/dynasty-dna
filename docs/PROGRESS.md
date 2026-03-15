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
