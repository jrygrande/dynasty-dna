# Dynasty DNA - Claude Development Guide

## Production Deployment Status
🚀 **Current Production URL:** https://dynasty-t5m7w25zl-jrygrandes-projects.vercel.app
📊 **Vercel Project:** jrygrandes-projects/dynasty-dna
🗄️ **Database:** Neon PostgreSQL (connected via DATABASE_URL)

## Deployment Commands (Vercel CLI)
```bash
# Automatic deployment (preferred)
git push origin main  # Auto-deploys to Vercel

# Manual deployment
vercel --prod         # Deploy to production
vercel               # Deploy preview

# Environment management
vercel env add VAR_NAME production
vercel env ls        # List all env vars
vercel env pull      # Pull env vars to .env.local
```

## Key Configuration Files
- `vercel.json` - Deployment config (Next.js, timeouts, regions)
- `.vercelignore` - Files excluded from deployment
- `.vercel/` - Auto-generated project config (git-ignored)

## Database Connection
- Production: Neon PostgreSQL
- Environment: `DATABASE_URL` set in Vercel
- Connection string format: `postgresql://user:pass@host/db?sslmode=require&channel_binding=require`

## Local development with dev DB

`.env.local` is pulled from Vercel and carries the **prod** `DATABASE_URL`. Naive local commands like `npm run db:migrate` or scripts using `getDb()` would otherwise mutate prod. To work safely, point local code at the Neon `dev` branch (project: `dynasty-dna`, branch: `dev` — copy-on-write off `production`).

### One-time setup
1. `cp .env.development.example .env.development` (gitignored).
2. Fill in `DATABASE_URL` and `DATABASE_URL_DEV` with the dev branch connection string from the Neon console.
3. Apply schema to the dev branch: `npm run db:dev:push`.
4. (Optional) Seed a representative league family from prod:
   ```bash
   DATABASE_URL_PROD_READ='postgresql://...prod...' npm run db:dev:seed -- --from-prod
   ```
   Idempotent. Defaults to the demo-eligible family. Override with `--root-league-id=<id>`.

### URL selection (see `src/db/index.ts` → `resolveDatabaseUrl`)
- **On Vercel** (any `VERCEL_ENV`) → always `DATABASE_URL`. Prod and preview are never redirected.
- **Off Vercel** → `DATABASE_URL_DEV` if set, else fall back to `DATABASE_URL`.

This means: if you set `DATABASE_URL_DEV` in `.env.local` (or `.env.development.local`), `npm run dev` and any `tsx` script transparently hit the dev branch. Unset it and you're back to prod (matches today's behaviour — no breakage).

### Dev-DB scripts
Each loads `.env.development` instead of `.env.local`, so prod is never touched even if `DATABASE_URL_DEV` is missing:
```bash
npm run db:dev:push       # drizzle-kit push   against dev
npm run db:dev:migrate    # drizzle-kit migrate against dev
npm run db:dev:studio     # Drizzle Studio     against dev
npm run db:dev:reset      # DROP + CREATE schema public against dev
npm run db:dev:seed       # copy one league family from prod -> dev (opt-in)
```

### Reset-DB safety guard
`npm run db:dev:reset` issues `DROP SCHEMA public CASCADE` and would silently nuke prod if `dotenv -e .env.development` failed to load (missing file, typo) and the script fell back to `.env.local`. To make that impossible, `scripts/reset-db.ts` resolves the URL via `resolveDatabaseUrl()` and refuses to run unless ANY of:

- The resolved hostname contains `-dev.` or `dev-branch` (the convention for Neon dev-branch hosts).
- The hostname appears in the comma-separated `NEON_DEV_HOST_ALLOWLIST` env var (use this if you renamed the dev branch).
- The CLI flag `--i-know-this-is-prod` is passed. **Escape hatch only** — for the rare maintenance case where you really do mean to wipe prod (e.g., recreating the prod schema from migrations). Combine with `dotenv -e .env.production.local` or similar; never run it casually.

On rejection the script prints the resolved host and the env-var path that produced it, then exits 1 before touching SQL. Tests live in `scripts/__tests__/reset-db-guard.test.ts`.

## Development Workflow
```bash
# Local development
npm run dev          # Start dev server on :3000
npm run build        # Test production build
npm run lint         # Check code quality
npm run db:studio    # Open Drizzle Studio

# Database operations
npm run db:generate  # Generate migrations
npm run db:migrate   # Run migrations
npm run db:push      # Push schema changes
```

## Project Structure
- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components
- `src/services/` - Business logic and data services
- `src/db/` - Database configuration and schema
- `src/lib/` - Shared utilities and configurations
- `src/lib/observability/` - Sentry breadcrumbs and transaction wrappers (issue #152)

## Observability (Sentry)

Sentry is the durable error/perf observability layer for sync runs (issue #152). It is fully DSN-driven: every helper and config file no-ops when `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` are unset.

### Env vars

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel (production + preview), `.env.local` | Browser/client init |
| `SENTRY_DSN` | Vercel (production + preview), `.env.local` | Server + edge runtime init |
| `SENTRY_AUTH_TOKEN` | Vercel only (CI/build) | Source map upload at build time |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` / `SENTRY_TRACES_SAMPLE_RATE` | Optional | Per-runtime traces sampling (default `0.1`) |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` / `SENTRY_ENVIRONMENT` | Optional | Override the `environment` tag |

### Local dev without Sentry

Leave the DSN env vars unset. Sync breadcrumbs print to the dev console as `[sync] { source, trigger, scope, durationMs, apiCalls, outcome, error }`. `withSyncTransaction` becomes a passthrough. No Sentry network traffic is generated.

### Setting up Sentry (one-time, maintainer)

1. Create a Sentry project at https://sentry.io (Next.js platform).
2. Copy the DSN from the project's "Client Keys (DSN)" page.
3. In the Vercel dashboard for `dynasty-dna`, add the DSN to **production** and **preview** environments as both `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` (same value).
4. Create a Sentry auth token (Settings -> Account -> API -> Auth Tokens with `project:releases` + `org:read`) and add it to Vercel as `SENTRY_AUTH_TOKEN` (production + preview only — not development).
5. Optionally `vercel env pull` and copy `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` into your local `.env.local` to validate Sentry locally.
6. The full Wave 2 work (breadcrumbs in every sync call, syncJobs audit fields, alerts) lands in follow-up PRs against issue #152.

### Files
- Per-runtime init: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Next.js entrypoint: `instrumentation.ts`
- Build wrapper: `next.config.mjs` (uses `withSentryConfig`)
- Breadcrumb helper: `src/lib/observability/syncBreadcrumb.ts`
- Transaction wrapper: `src/lib/observability/withSyncTransaction.ts`

## Common URLs
- Health check: `/api/health`
- Roster page: `/roster?leagueId=X&rosterId=Y`
- Player scoring: `/player-scoring?leagueId=X&playerId=Y&playerName=Z`

## Troubleshooting Deployments
- Build errors: Check TypeScript strict mode issues
- Database errors: Verify DATABASE_URL is set in Vercel env vars
- API timeouts: Configured for 30s max duration in vercel.json

## Cron jobs

Reference data refreshes run on Vercel Cron and are defined in `vercel.json` under the `crons` block. Every job is gated by `Authorization: Bearer $CRON_SECRET` (`CRON_SECRET` is set in Vercel for production + preview + development, mirrored in `.env.local`).

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/sleeper-players` | Daily `0 6 * * *` | `syncPlayers(force=true)` — refresh Sleeper player dictionary. |
| `/api/cron/fantasycalc` | Daily `0 7 * * *` | Enumerate distinct `(SF, PPR, numTeams, numQbs)` combos via `getDistinctFantasyCalcConfigs()` and refresh each with `force: true`. Per-combo failures are isolated. |
| `/api/cron/nflverse-current` | Daily `0 8 * * *` | Injuries + roster status + schedule for the current NFL season (from `currentSeason()`), all `force: true` so the watermark fast-path doesn't suppress weekly updates. |
| `/api/cron/nflverse-historical` | Weekly `0 9 * * 0` (Sunday) | Loops 2002 → currentSeason-1 with `force: false` so the watermark/skip-if-rows-exist guard makes most seasons cheap no-ops. The handler self-gates to the **first Sunday of each month** because Vercel Hobby caps at daily granularity; off-month invocations return 200 with `summary.ranWork=false`. |

All four routes:
- Return 401 unless the bearer token matches `CRON_SECRET`
- Wrap their body in `withSyncTransaction(name, op, fn)` so Sentry sees a single span per cron tick
- Call `recordSyncBreadcrumb({ source, trigger: 'cron', ... })` on entry, success, partial, and failure (no-op when no Sentry DSN is set; falls back to `console.info`)
- Emit one structured JSON line via `console.log` (e.g. `{"msg":"cron.sleeper-players.complete","durationMs":...}`) so Vercel function logs are searchable
- Return `{ ok, durationMs, callsMade, summary }` on success, or 5xx with `{ ok: false, error }` on failure
- Are idempotent — a re-fired tick is safe

### Manual verification
```bash
# from your shell, with CRON_SECRET set (matches Vercel env)
curl -i https://<deploy>/api/cron/sleeper-players                         # → 401
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/sleeper-players  # → 200
```

## Dependencies Removed
- Redis/ioredis - Removed for simplified deployment (no caching layer currently)

## Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Database:** PostgreSQL with Drizzle ORM
- **Deployment:** Vercel
- **Styling:** Tailwind CSS + shadcn/ui components
- **External APIs:** Sleeper Fantasy Sports API

## Design system

Dynasty DNA uses a Claude-inspired token system: warm cream canvas, warm slate ink, sage as the only chromatic accent. **Never use raw Tailwind palette classes** (`bg-blue-500`, `text-emerald-400`, `bg-gray-100`, etc.) — an ESLint rule (`.eslintrc.json`) enforces this.

Visit [`/design`](http://localhost:3000/design) in dev for the live reference: 20 specimen cards + the real shadcn primitives rendered with current tokens.

### Color tokens

| Role | Use | Class |
|---|---|---|
| Canvas | Page background, never pure white | `bg-background` (cream-50) |
| Ink | Primary text, never pure black | `text-foreground` (slate-900) |
| Accent | Links, primary buttons, positive signals, brand mark | `text-primary` / `bg-primary` (sage-500) |
| Muted | Secondary text, inactive states, subtle fills | `text-muted-foreground` / `bg-muted` |
| Cards | Raised surfaces | `bg-card` (white), with `border-border` hairline |
| Destructive | Errors, irreversible actions | `bg-destructive` / `text-destructive` |
| Grades A–F | ONLY in `GradeBadge` / grade columns | `text-grade-a..f` + `bg-grade-a..f/12` for fills |
| Charts | Recharts series + muted categorical tags | `text-chart-1..6` / `bg-chart-1..6/15` |
| Brand scales | Direct access when needed | `sage-{50..900}`, `cream-{50..300}`, `slate-{300..900}` |

### Common recipes

- **Positive/gain**: `text-primary` (not `text-green-*`)
- **Negative/drop**: `text-muted-foreground` with Unicode `−` (not `text-red-*`)
- **Error/danger**: `bg-grade-f/8 text-grade-f border-grade-f/25`
- **Success/confirmed**: `bg-grade-a/8 text-grade-a border-grade-a/25`
- **Warning/in-progress**: `bg-grade-c/8 text-grade-c border-grade-c/25`
- **Info/neutral badge**: `bg-grade-b/8 text-grade-b`

### Typography

| Font | When | Class |
|---|---|---|
| Inter | Default UI everywhere | `font-sans` (default, no class needed) |
| Source Serif 4 | **Marketing/editorial display only** — landing hero, public-page h1 | `font-serif` |
| JetBrains Mono | **Every number** — stats, points, percentiles, grades, IDs | `font-mono` (tabular by default) |

In-app headings (dashboard, league, player) stay Inter — the density is in the data, not the chrome.

### Badges vs tags

- **Grade badges** (A+, B, D−): bordered rectangle chip, `font-bold`, earned-rating treatment — use `<GradeBadge />`.
- **Categorical tags** (positions, statuses, transaction types): `rounded-full` pill, `font-mono uppercase tracking-wide`, no border — metadata treatment. See `POSITION_COLORS` in drafts page + `<StatusBadge />` + `<TypeBadge />`.

### Where to look

- Tokens: [`src/app/globals.css`](src/app/globals.css) + [`tailwind.config.ts`](tailwind.config.ts)
- Shared primitives: [`src/components/GradeBadge.tsx`](src/components/GradeBadge.tsx), [`StatusBadge.tsx`](src/components/StatusBadge.tsx), [`TransactionCard.tsx`](src/components/TransactionCard.tsx) (exports `TypeBadge`)
- Shadcn primitives: [`src/components/ui/`](src/components/ui/) — prefer these for new components
- Brand mark: [`src/components/BrandMark.tsx`](src/components/BrandMark.tsx)
- Full handoff bundle (preview HTML cards): [`public/design-preview/`](public/design-preview/)