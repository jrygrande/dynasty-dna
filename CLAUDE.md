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

## Common URLs
- Health check: `/api/health`
- Roster page: `/roster?leagueId=X&rosterId=Y`
- Player scoring: `/player-scoring?leagueId=X&playerId=Y&playerName=Z`

## Troubleshooting Deployments
- Build errors: Check TypeScript strict mode issues
- Database errors: Verify DATABASE_URL is set in Vercel env vars
- API timeouts: Configured for 30s max duration in vercel.json

## Dependencies Removed
- Redis/ioredis - Removed for simplified deployment (no caching layer currently)

## Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Database:** PostgreSQL with Drizzle ORM
- **Deployment:** Vercel
- **Styling:** Tailwind CSS + shadcn/ui components
- **External APIs:** Sleeper Fantasy Sports API