# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dynasty DNA is a web application that analyzes dynasty fantasy football league data from Sleeper, providing insights into transaction histories, player performance, and manager effectiveness. The name reflects how the app traces the "genetic makeup" of team construction through trade chains and roster decisions.

## Technology Stack

- **Database:** SQLite with Prisma ORM (free, serverless, perfect for MVP)
- **Backend:** Node.js + Express + TypeScript
- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS
- **State Management:** Zustand
- **Visualization:** D3.js for transaction trees, Recharts for charts
- **Data Sources:** Sleeper API (primary), nflverse (Phase 2+)

## Common Development Commands

```bash
# Backend commands (from /backend directory)
npm install                  # Install dependencies
npm run dev                  # Start development server with hot reload
npm run build               # Build for production
npm run lint                # Run ESLint
npm run typecheck           # Run TypeScript type checking

# Database commands
npx prisma migrate dev      # Create and apply database migrations
npx prisma studio           # Open Prisma Studio GUI for database
npx prisma generate         # Regenerate Prisma Client after schema changes
npm run db:reset            # Reset database and reseed with test data

# Development data seeding
npm run seed:dev            # Sync complete dynasty history for test league
npm run seed:current        # Sync only current season data
npm run db:stats            # Show detailed database statistics

# Frontend commands (from /frontend directory)
npm install                 # Install dependencies
npm run dev                # Start Vite dev server
npm run build              # Build for production
npm run preview            # Preview production build
npm run lint               # Run ESLint
npm run typecheck          # Run TypeScript type checking

# Running the full application
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

## Architecture & Key Concepts

### Transaction Chain Algorithm
The core value proposition is visualizing how players and draft picks move through leagues via trades. The transaction chain algorithm:
1. Parses all historical transactions from Sleeper API
2. Builds a directed graph of asset movements
3. Recursively traverses to create tree structures for visualization
4. Tracks draft picks through multiple trades until they become players

### Data Synchronization Strategy
- Sleeper API has no auth requirements and 1000 req/min rate limit
- Transactions are fetched by week (1-18 for regular season + playoffs)
- All data is cached in SQLite database
- Sync runs on-demand or scheduled (future enhancement)

### API Design Pattern
Backend endpoints follow RESTful conventions:
- `/api/leagues/{league_id}/sync` - Trigger data sync
- `/api/players/{player_id}/transaction-chain` - Get trade history tree
- `/api/rosters/{roster_id}/acquisition` - How each player was acquired

### State Management
- Zustand stores are organized by domain (league, transactions, UI)
- API calls are made through service layer with automatic error handling
- Loading states are managed globally for consistent UX

## Sleeper API Integration

**Base URL:** `https://api.sleeper.app/v1`
**Rate Limit:** 1000 requests/minute
**Key Endpoints:**
- `GET /league/{league_id}` - League configuration and scoring
- `GET /league/{league_id}/rosters` - Current team rosters
- `GET /league/{league_id}/transactions/{week}` - Weekly transactions
- `GET /league/{league_id}/traded_picks` - Draft pick trades

**Test League:** 
- Name: "Dynasty Domination"
- ID: 1191596293294166016
- Username: jrygrande

## Database Schema

The Prisma schema (`backend/prisma/schema.prisma`) defines:
- **League:** Stores league metadata and scoring settings
- **Transaction:** All trades, waivers, and free agent moves
- **TransactionItem:** Individual assets in each transaction
- **Player:** Player metadata from Sleeper
- **DraftPick:** Tracks picks through trades to eventual selection
- **Roster:** Point-in-time roster snapshots

## Project Structure

```
dynasty-dna/
├── backend/
│   ├── src/
│   │   ├── api/          # Express routes and middleware
│   │   ├── services/     # Business logic and Sleeper client
│   │   ├── db/          # Database queries and migrations
│   │   └── types/       # TypeScript interfaces
│   └── prisma/          # Schema and migrations
├── frontend/
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── pages/      # Route-based page components
│   │   ├── hooks/      # Custom React hooks
│   │   └── services/   # API client
└── shared/
    └── types/          # Shared TypeScript types
```

## Phase-Based Development

**Phase 1 (Current):** Core transaction visualization using only Sleeper data
**Phase 2:** Integrate player statistics from Sleeper matchups endpoint
**Phase 3:** Calculate fantasy points with custom scoring
**Phase 4:** Trade effectiveness metrics
**Phase 5:** Premium features and monetization

## Important Implementation Notes

1. **Transaction Week Pagination:** Sleeper returns transactions by week (1-18), not all at once
2. **Draft Pick Complexity:** Picks can be traded multiple times before being used
3. **Player ID Mapping:** Phase 2+ requires mapping between Sleeper and nflverse IDs
4. **Rate Limiting:** Implement exponential backoff for Sleeper API calls
5. **Caching Strategy:** Cache everything except current week during season

## Development Data Setup

### Ensuring Full Test Data

The test league "Dynasty Domination" (ID: 1191596293294166016) spans multiple seasons (2021-2025). To ensure complete data for development:

1. **Initial Setup:** Run `npm run seed:dev` to sync the full dynasty history
2. **Daily Development:** Use `npm run seed:current` to update only current season
3. **After Schema Changes:** Run `npm run db:reset` to reset and reseed
4. **Verify Data:** Use `npm run db:stats` to check data completeness

### Data Seeding Options

```bash
# Full dynasty history sync (recommended for new development environments)
npm run seed:dev

# Current season only (faster for daily development)
npm run seed:current

# With verbose output and cache clearing
npm run seed:dev -- --verbose --clear-cache

# Current season with verbose output
npm run seed:current -- --verbose
```

### Database Verification

Use `npm run db:stats` to verify:
- Transaction counts per season
- Week coverage (should show weeks 1-17 for completed seasons, week 1 for current season)
- Dynasty chain continuity
- Test league presence and data completeness