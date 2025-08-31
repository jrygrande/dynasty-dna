# Dynasty DNA - Product Requirements Document

## Executive Summary

**Product Name:** Dynasty DNA  
**Version:** 1.0  
**Status:** Ready for Development  
**Last Updated:** August 31, 2025

### Purpose
Build a web application that analyzes and visualizes dynasty fantasy football league data from Sleeper, providing insights into transaction histories, player performance, and manager effectiveness. Dynasty DNA reveals the genetic makeup of your team's history - tracing the lineage of every trade, pick, and roster decision.

### Problem Statement
Dynasty fantasy football managers using Sleeper lack tools to:
- Track complex multi-year transaction chains
- Measure trade effectiveness over time with actual fantasy points
- Analyze year-over-year manager performance
- Understand the full impact of roster decisions
- Calculate custom fantasy scoring for historical player performance

## Technical Requirements

### Architecture Overview
- **Frontend:** React-based web application
- **Backend:** Node.js API server
- **Database:** PostgreSQL (or SQLite for MVP)
- **Caching:** Redis or in-memory cache for API responses
- **Hosting:** Vercel/Netlify (frontend), Railway/Render (backend)
- **Development Approach:** Start simple, build for future scalability

### Data Sources

#### Primary Source
1. **Sleeper API** - https://docs.sleeper.com/
   - League settings, rosters, transactions, drafts
   - Individual player weekly scoring data via matchups endpoint
   - Complete fantasy points for all players by week
   - Rate limit: 1000 calls/minute

#### Data Integration Strategy
- Use Sleeper API as the sole data source for all functionality
- Matchups endpoint provides individual player fantasy points for every week
- No external data integration required - Sleeper has all necessary scoring data
- Calculate trade effectiveness using actual fantasy points from Sleeper

#### Test Environment
- League Name: "Dynasty Domination"
- 2025 League ID: 1191596293294166016
- Test Username: jrygrande

## Core Features (MVP)

### 1. Transaction Chain Visualization
**User Story:** As a manager, I want to see the complete history of how a player or draft pick moved through my league.

**Requirements:**
- Display transaction trees showing all related trades stemming from an original asset
- Support multi-year transaction tracking
- Show all intermediate steps in complex trade chains

**Example Implementation:**
```
Travis Kelce (Drafted 2021, Round 3, Pick 4 by jrygrande)
├── Traded to Acruz1215 for:
│   ├── 2023 1st Round Pick
│   │   └── Traded with Tua to agiotis for:
│   │       ├── agiotis' 2023 1st → Selected Jahmyr Gibbs
│   │       ├── Rashod Bateman
│   │       └── Russell Wilson → Traded to Stove17 for 2025 2nd → Selected Cam Skattebo
│   └── 2024 1st Round Pick
│       └── Traded with 2024 2nd to kingjustin713 for:
│           └── agiotis' 2024 1st → Selected Brock Bowers
```

### 2. Player Performance Tracking
**User Story:** As a manager, I want to understand how players performed during their time on each roster.

**Metrics to Track:**
- NFL games played between transactions
- Fantasy weeks in starting lineup vs bench
- Total points scored (separated by starter/bench status)
- Points per game
- Games missed due to injury
- Performance by season

### 3. Roster Acquisition Analysis
**User Story:** As a manager, I want to see how I acquired each player on my current roster.

**Display Information:**
- Acquisition method: Draft/Trade/Waiver/Free Agency
- Acquisition details: Pick number, trade partners, FAAB spent
- Player tenure on roster
- Historical roster movements

### 4. Trade Effectiveness Calculator (Phase 2)
**User Story:** As a manager, I want to measure whether my trades were beneficial using actual performance data.

**Calculations:**
- **Actual fantasy points** scored by outgoing vs incoming players (from Sleeper matchups data)
- Points already calculated using league's exact scoring settings
- Win contribution analysis based on real performance
- Future value assessment for draft picks (using actual selected players)
- Time-weighted performance metrics
- "What-if" analysis showing potential points if players were started

### 5. Draft Success Analytics (Phase 2)
**User Story:** As a manager, I want to evaluate my drafting effectiveness with real data.

**Metrics:**
- **Actual fantasy points** scored vs positional benchmarks (from Sleeper matchups data)
- Career value of drafted players (cumulative fantasy points)
- Hit rate by round based on performance thresholds
- Comparison to league average using actual scoring
- Best/worst picks analysis with hindsight

## API Design

### Endpoints Structure
```
GET /api/leagues/{league_name}/history
GET /api/leagues/{league_id}/transactions
GET /api/leagues/{league_id}/scoring-settings
GET /api/players/{player_id}/transaction-chain
GET /api/players/{player_id}/performance
GET /api/players/{player_id}/fantasy-points?week={week}&year={year}
GET /api/managers/{username}/roster-acquisition
GET /api/managers/{username}/draft-analysis
GET /api/trades/{trade_id}/effectiveness
POST /api/leagues/sync
POST /api/stats/calculate-fantasy-points
```

### Data Synchronization Strategy
1. **Sleeper Data**: 
   - Cache league structure (permanent)
   - Cache historical transactions (permanent)
   - Cache historical matchup/scoring data (permanent)
   - Refresh current season data (1 hour)
   - Sync player weekly scores from matchups endpoint

### Player Scoring Data Access
```javascript
// Access player fantasy points directly from Sleeper matchups
const getPlayerWeeklyScoring = async (leagueId, week) => {
  const matchups = await sleeperApi.getMatchups(leagueId, week);
  const playerScores = [];
  
  for (const matchup of matchups) {
    const { roster_id, players_points, starters } = matchup;
    
    for (const [playerId, points] of Object.entries(players_points)) {
      playerScores.push({
        playerId,
        rosterId: roster_id,
        week,
        points,
        isStarter: starters.includes(playerId)
      });
    }
  }
  
  return playerScores;
};
```

## Database Schema (Simplified)

### Core Tables
```sql
-- Leagues
leagues (id, sleeper_league_id, year, name, previous_league_id, scoring_settings)

-- Transactions
transactions (id, league_id, type, week, timestamp, status)
transaction_items (id, transaction_id, manager_id, player_id, draft_pick_id, faab_amount)

-- Players  
players (id, sleeper_id, name, position, team)
player_weekly_scores (id, league_id, player_id, roster_id, week, season, points, is_starter, position, matchup_id)

-- Managers
managers (id, username, display_name)
roster_history (id, manager_id, player_id, acquired_date, released_date, acquisition_type)

-- Draft Picks
draft_picks (id, original_owner_id, current_owner_id, year, round, pick_number, player_selected_id)

-- Matchup Results
matchup_results (id, league_id, roster_id, week, season, matchup_id, total_points, opponent_id, won)
```

## UI/UX Requirements

### Key Views

#### Phase 1 Views (Sleeper Data Only)
1. **Transaction Explorer:** Interactive tree visualization of transaction chains
   - Click any player/pick to see their complete trade history
   - Expand/collapse trade branches
   - Filter by year, team, or asset type

2. **Roster Timeline:** Visual history of roster construction
   - Timeline showing when each player joined/left
   - Color-coded by acquisition type
   - Hover for transaction details

3. **Manager Profile:** Overview without performance metrics
   - Current roster with acquisition details
   - Trade history and partners
   - Draft pick inventory (current and future)

#### Phase 2+ Views (With Stats Integration)
4. **Player Card:** Detailed player history and performance metrics
   - Fantasy points by week/season
   - Performance during roster tenure
   - Trade value over time

5. **Trade Analyzer:** Side-by-side comparison of trade outcomes
   - Actual points gained/lost
   - Impact on weekly matchups
   - Long-term value assessment

### Design Principles
- Mobile-responsive design
- Dark mode support
- Interactive visualizations using D3.js or Chart.js
- Clean, data-focused interface
- Fast load times (< 2s initial load)
- **Progressive enhancement: Core features work without stats data**

## Development Phases

### Phase 1: Foundation & Core Visualizations (Weeks 1-2)
- Set up project structure and development environment
- Implement Sleeper API integration with caching
- Create database schema for league, transaction, and roster data
- **Build Transaction Chain Visualization**
  - Parse historical transactions from Sleeper
  - Create tree structure for trade chains
  - Track draft pick movement through trades
  - Build interactive visualization UI
- **Implement Roster Acquisition Analysis**
  - Track how each player joined rosters (draft/trade/waiver)
  - Show acquisition costs (draft position, trade package, FAAB)
  - Display player tenure on each roster
- Basic web UI with routing

### Phase 2: Player Scoring & Performance Tracking (Weeks 3-4)
- **Integrate Sleeper matchups data**
  - Sync historical player weekly scoring from matchups endpoint
  - Store individual player fantasy points by week/season
  - Track starter vs bench performance
- **Player performance tracking with actual fantasy points**
  - Use Sleeper's pre-calculated fantasy points
  - Track historical performance during roster tenure
  - Build trade effectiveness analysis

### Phase 3: Advanced Analytics (Weeks 5-6)
- Trade effectiveness calculator with real performance data
- Draft success metrics using actual points scored
- "What-if" analysis tools (optimal lineups, alternative trade outcomes)
- Manager comparison tools

### Phase 4: Polish & Optimization (Week 7)
- UI/UX improvements and responsive design
- Performance optimization and caching strategy
- Testing and bug fixes
- Data validation and accuracy checks
- Documentation and deployment

## Success Criteria

### Phase 1 Success Metrics
- Successfully track and visualize multi-year transaction chains using only Sleeper data
- Load transaction history for a full league in < 5 seconds
- Accurately trace all draft pick trades through completion
- Clear visualization of roster construction history
- Intuitive UI that requires no documentation for basic use

### Phase 2+ Success Metrics
- **Accurate import of player fantasy points from Sleeper matchups data**
- Reliable weekly scoring data updates during the season
- Complete historical player performance tracking
- Clear data lineage showing the "DNA" of roster construction

## Technical Constraints
- Must respect Sleeper API rate limits (1000 calls/minute)
- Initial deployment using free-tier services only
- No user authentication required for MVP
- Support leagues with 10+ years of history
- Must sync complete historical player scoring data
- Handle custom league scoring configurations

## Future Enhancements (Post-MVP)
- Multi-league support
- User authentication and personalized dashboards
- Email/SMS alerts for trade analysis
- Machine learning for trade recommendations
- Mobile app
- Integration with other fantasy platforms
- Premium features and monetization

## Implementation Examples

### Syncing Player Weekly Scores
```javascript
// Sync all player weekly scoring data from Sleeper matchups
async function syncPlayerWeeklyScores(leagueId, season) {
  const allPlayerScores = [];
  
  for (let week = 1; week <= 18; week++) {
    const matchups = await sleeperClient.getMatchups(leagueId, week);
    
    for (const matchup of matchups) {
      const { roster_id, players_points, starters, matchup_id } = matchup;
      
      for (const [playerId, points] of Object.entries(players_points)) {
        const isStarter = starters.includes(playerId);
        
        allPlayerScores.push({
          leagueId,
          playerId,
          rosterId: roster_id,
          week,
          season,
          points,
          isStarter,
          matchupId: matchup_id
        });
      }
    }
  }
  
  return allPlayerScores;
}
```

### Transaction Chain Analysis
```javascript
// Trace the complete lineage of a player/pick through trades
async function traceTransactionChain(assetId, leagueId) {
  const chain = [];
  const visited = new Set();
  
  async function traverse(currentAssetId) {
    if (visited.has(currentAssetId)) return;
    visited.add(currentAssetId);
    
    // Get all transactions involving this asset
    const transactions = await getTransactionsForAsset(currentAssetId);
    
    for (const transaction of transactions) {
      chain.push(transaction);
      
      // Find what this asset was traded for
      const receivedAssets = transaction.received_assets;
      for (const asset of receivedAssets) {
        await traverse(asset.id);
      }
    }
  }
  
  await traverse(assetId);
  return buildTransactionTree(chain);
}
```

## Contact
**Product Owner:** Ryan Grande (john.ryan.grande@gmail.com)