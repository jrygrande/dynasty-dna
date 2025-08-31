# Sleeper API - Comprehensive Analysis & Implementation Guide

**Last Updated:** August 31, 2025  
**API Version:** v1  
**Test League:** Dynasty Domination (ID: 1191596293294166016)

## Executive Summary

This document provides a comprehensive analysis of the Sleeper API based on thorough exploration of documentation and actual API responses. It identifies key data structures, relationships, limitations, and implementation strategies for the Dynasty DNA project.

## API Overview

- **Base URL:** `https://api.sleeper.app/v1`
- **Authentication:** None required
- **Rate Limit:** Under 1000 API calls per minute
- **Response Format:** JSON
- **Primary Focus:** NFL fantasy football data

## Critical API Insights

### 1. Timing & Timestamps

#### NFL State Endpoint
```
GET /v1/state/nfl
```
**Purpose:** Provides accurate season timing context for transaction timestamps

**Response Structure:**
```json
{
  "week": 1,
  "leg": 1, 
  "season": "2025",
  "season_type": "regular",
  "league_season": "2025",
  "previous_season": "2024",
  "season_start_date": "2025-09-04",
  "display_week": 1,
  "league_create_season": "2025",
  "season_has_scores": true
}
```

#### Draft Timing
Draft endpoints provide precise timestamps:
- `start_time`: When draft began (milliseconds)
- `last_picked`: Last pick timestamp
- `created`: Draft creation timestamp

### 2. Draft Pick Ownership Model (Three-Way Tracking)

**Key Discovery:** Draft picks track ownership through THREE IDs:

- **`roster_id`**: Original owner of the pick
- **`previous_owner_id`**: Who most recently traded it away
- **`owner_id`**: Current owner

**Example Chain:**
```
2025 R1 Pick: roster_1 → roster_7 → roster_8
- roster_id: 1 (original owner)
- previous_owner_id: 7 (traded it to current owner)
- owner_id: 8 (current owner)
```

This enables full reconstruction of multi-hop trade chains.

## Core Data Models

### 1. League Model

```json
{
  "league_id": "1191596293294166016",
  "name": "Dynasty Domination",
  "season": "2025",
  "status": "in_season",
  "sport": "nfl",
  "season_type": "regular",
  "previous_league_id": "1051592789462589440",
  "total_rosters": 12,
  "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", ...],
  "scoring_settings": {
    "rec": 0.5,
    "pass_td": 4.0,
    "rush_td": 6.0,
    "rec_td": 6.0,
    "pass_int": -2.0,
    "fum_lost": -1.0,
    // ... 50+ additional scoring fields
  },
  "settings": {
    "draft_rounds": 4,
    "num_teams": 12,
    "playoff_teams": 6,
    "pick_trading": 1,
    "trade_deadline": 11,
    // ... extensive league configuration
  }
}
```

**Key Points:**
- `previous_league_id` enables dynasty continuity tracking
- Scoring settings are complex with 50+ fields
- Settings include trade deadlines and pick trading rules

### 2. Transaction Model

#### Trade Transaction
```json
{
  "transaction_id": "1254869151504142336",
  "type": "trade",
  "status": "complete", // or "failed"
  "created": 1753546629361, // millisecond timestamp
  "week": 1,
  "roster_ids": [7, 10],
  "consenter_ids": [7, 10],
  "adds": null, // or {"player_id": roster_id}
  "drops": null, // or {"player_id": roster_id}
  "draft_picks": [
    {
      "round": 3,
      "season": "2027",
      "roster_id": 10, // original owner
      "owner_id": 7, // current owner
      "previous_owner_id": 10 // who traded it
    }
  ],
  "waiver_budget": []
}
```

#### Waiver Transaction
```json
{
  "transaction_id": "1266215555392618498",
  "type": "waiver",
  "status": "complete",
  "created": 1756251822855,
  "adds": {"12474": 6}, // player_id: roster_id
  "drops": {"12542": 6},
  "settings": {
    "seq": 0,
    "waiver_bid": 21
  }
}
```

**Key Points:**
- Transactions are fetched by week (1-18)
- `adds`/`drops` use player_id as key, roster_id as value
- Failed transactions are included and important for analysis
- Draft picks in trades include full ownership chain

### 3. Roster Model

```json
{
  "roster_id": 1,
  "owner_id": "233789917321228288",
  "league_id": "1191596293294166016",
  "players": ["10232", "11565", "11582", ...], // player ID strings
  "starters": ["6797", "11584", "5967", ...], // subset of players
  "settings": {
    "wins": 0,
    "losses": 0,
    "ties": 0,
    "fpts": 0, // total fantasy points
    "fpts_against": 0,
    "waiver_budget_used": 0,
    "waiver_position": 5
  }
}
```

**Key Points:**
- Player IDs are strings, not integers
- Separate arrays for all players vs. starters
- Settings track wins/losses and FAAB usage

### 4. Draft Pick Models

#### Traded Picks (League Level)
```json
{
  "round": 1,
  "season": "2025",
  "roster_id": 1, // original owner
  "owner_id": 8, // current owner  
  "previous_owner_id": 7 // who traded it to current owner
}
```

#### Draft Selections
```json
{
  "draft_id": "1191596293294166017",
  "pick_no": 1,
  "round": 1,
  "draft_slot": 1,
  "roster_id": 9,
  "player_id": "12527",
  "picked_by": "718879062688366592",
  "metadata": {
    "first_name": "Ashton",
    "last_name": "Jeanty",
    "position": "RB",
    "team": "LV"
  }
}
```

### 5. User Model

```json
{
  "user_id": "233789917321228288",
  "username": "andrewduke23", 
  "display_name": "andrewduke23",
  "avatar": "1a5068c18f623797eb933ff43906521e",
  "is_owner": true,
  "metadata": {
    "team_name": "Who Needs Qbs",
    "allow_pn": "on",
    "transaction_trade": "on"
  }
}
```

### 6. Matchup Model ✅ **CRITICAL FOR DYNASTY DNA**

```json
{
  "roster_id": 1,
  "matchup_id": 4,
  "points": 144.62, // TEAM TOTAL POINTS
  "players": ["10232", "11565", "2197", ...], // All roster players
  "starters": ["6797", "11584", "2197", ...], // Starting lineup
  "starters_points": [28.08, 12.4, 15.0, ...], // Individual starter points
  "players_points": {
    "10232": 7.5,  // Individual player fantasy points
    "11565": 1.42,
    "2197": 15.0,
    "3634": 2.42
    // ALL players with their weekly fantasy scores
  }
}
```

**🎯 GAME CHANGER:** The matchups endpoint provides **COMPLETE individual player fantasy scoring by week**! This enables full trade effectiveness analysis using only Sleeper data.

## Complete Fantasy Analysis Using Only Sleeper API! 🎉

### What Sleeper API Provides ✅
✅ League structure and settings  
✅ Transaction history (trades, waivers, etc.)  
✅ Roster compositions over time  
✅ Draft selections and pick trades  
✅ Team-level matchup scores  
✅ **Individual player fantasy points by week** (via matchups endpoint)  
✅ **Starter vs bench performance tracking**  
✅ **Complete trade effectiveness analysis capability**  

### What Sleeper API Does NOT Provide (Optional for Dynasty DNA)
❓ Raw NFL stats (yards, TDs, etc.) - not needed for our analysis  
❓ Advanced analytics beyond fantasy points - can be calculated  

### Dynasty DNA Can Now Deliver Complete Analysis
- **Phase 1:** Transaction chains, roster tracking, trade visualization, AND trade effectiveness
- **Phase 2:** Advanced analytics, "what-if" scenarios, manager performance metrics
- **No external data integration required** for core functionality!

## Implementation Strategy

### Phase 1: Data Synchronization

#### 1. League Discovery & Continuity
```javascript
// Fetch league chain
async function getLeagueChain(currentLeagueId) {
  const chain = [];
  let leagueId = currentLeagueId;
  
  while (leagueId) {
    const league = await fetch(`/v1/league/${leagueId}`);
    chain.push(league);
    leagueId = league.previous_league_id;
  }
  
  return chain.reverse(); // oldest to newest
}
```

#### 2. NFL State for Timestamps
```javascript
// Get season context
const nflState = await fetch('/v1/state/nfl');
const seasonStart = new Date(nflState.season_start_date);
```

#### 3. Transaction Synchronization
```javascript
// Fetch all transactions for a league
async function syncLeagueTransactions(leagueId) {
  const allTransactions = [];
  
  for (let week = 1; week <= 18; week++) {
    const weekTransactions = await fetch(`/v1/league/${leagueId}/transactions/${week}`);
    allTransactions.push(...weekTransactions);
  }
  
  return allTransactions;
}
```

#### 4. **CRITICAL: Player Weekly Scoring Synchronization**
```javascript
// Sync all player weekly scoring data
async function syncPlayerWeeklyScores(leagueId, season) {
  const allPlayerScores = [];
  
  // Fetch matchups for all weeks
  for (let week = 1; week <= 18; week++) {
    const matchups = await fetch(`/v1/league/${leagueId}/matchups/${week}`);
    
    for (const matchup of matchups) {
      const { roster_id, players_points, starters, starters_points } = matchup;
      
      // Store every player's weekly score
      for (const [playerId, points] of Object.entries(players_points)) {
        const isStarter = starters.includes(playerId);
        
        allPlayerScores.push({
          leagueId,
          playerId,
          rosterId: roster_id,
          week,
          season,
          points,
          isStarter
        });
      }
    }
  }
  
  return allPlayerScores;
}
```

### Phase 2: Draft Pick Chain Reconstruction

#### Algorithm for Multi-Hop Tracking
```javascript
function buildPickTradeChain(tradedPicks, transactions) {
  const chains = {};
  
  for (const pick of tradedPicks) {
    const key = `${pick.season}_R${pick.round}_${pick.roster_id}`;
    
    chains[key] = {
      originalOwner: pick.roster_id,
      currentOwner: pick.owner_id,
      immediateTrader: pick.previous_owner_id,
      // Find all transactions involving this pick
      transactions: findPickTransactions(pick, transactions)
    };
  }
  
  return chains;
}
```

### Phase 3: **Trade Effectiveness Analysis (Now Possible with Sleeper Data!)**

#### Calculate Actual Trade Value
```javascript
// Calculate actual fantasy points gained/lost in a trade
async function calculateTradeEffectiveness(tradeTransaction, playerScores) {
  const tradeDate = new Date(tradeTransaction.timestamp);
  const analysis = {
    tradedAway: [],
    tradedFor: [],
    netPointsGained: 0,
    weeksAnalyzed: 0
  };
  
  // Analyze performance after trade date
  for (const [playerId, rosterId] of Object.entries(tradeTransaction.adds || {})) {
    const playerPoints = playerScores
      .filter(score => 
        score.playerId === playerId && 
        new Date(score.week) > tradeDate
      )
      .reduce((sum, score) => sum + score.points, 0);
      
    analysis.tradedFor.push({ playerId, totalPoints: playerPoints });
  }
  
  for (const [playerId, rosterId] of Object.entries(tradeTransaction.drops || {})) {
    const playerPoints = playerScores
      .filter(score => 
        score.playerId === playerId && 
        new Date(score.week) > tradeDate
      )
      .reduce((sum, score) => sum + score.points, 0);
      
    analysis.tradedAway.push({ playerId, totalPoints: playerPoints });
  }
  
  // Calculate net gain
  const pointsGained = analysis.tradedFor.reduce((sum, p) => sum + p.totalPoints, 0);
  const pointsLost = analysis.tradedAway.reduce((sum, p) => sum + p.totalPoints, 0);
  analysis.netPointsGained = pointsGained - pointsLost;
  
  return analysis;
}
```

#### "What-If" Analysis
```javascript
// Calculate what points would have been if different lineup decisions were made
function calculateOptimalLineups(weeklyScores, rosterPositions) {
  return weeklyScores.map(week => {
    // Sort players by points for optimal lineup
    const sorted = week.playerScores.sort((a, b) => b.points - a.points);
    const optimal = selectOptimalStarters(sorted, rosterPositions);
    const actual = week.actualStarters;
    
    return {
      week: week.number,
      actualPoints: actual.reduce((sum, p) => sum + p.points, 0),
      optimalPoints: optimal.reduce((sum, p) => sum + p.points, 0),
      pointsLeftOnBench: optimal.totalPoints - actual.totalPoints
    };
  });
}
```

## Database Schema Updates Required

Based on API exploration, the following schema changes are needed:

### 1. Add Previous Owner Tracking
```prisma
model DraftPick {
  id              String @id @default(cuid())
  leagueId        String
  originalOwnerId String  // roster_id from API
  currentOwnerId  String  // owner_id from API  
  previousOwnerId String? // previous_owner_id from API - NEW FIELD
  year            Int
  round           Int
  pickNumber      Int?
  playerSelectedId String?
  traded          Boolean @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 2. Timestamp Storage
```prisma
model Transaction {
  id          String   @id @default(cuid())
  leagueId    String
  type        String
  status      String
  week        Int?
  timestamp   BigInt   // Store millisecond timestamps
  createdAt   DateTime @default(now())
}
```

### 3. NFL State Cache
```prisma
model NFLState {
  id              String @id @default(cuid()) 
  season          String @unique
  seasonType      String
  week            Int
  seasonStartDate DateTime
  lastUpdated     DateTime @default(now())
}
```

### 4. **CRITICAL: Player Weekly Scoring Models**
```prisma
model PlayerWeeklyScore {
  id            String   @id @default(cuid())
  leagueId      String
  playerId      String
  rosterId      Int      // Which roster owned player this week
  week          Int
  season        String
  points        Float    // Fantasy points scored
  isStarter     Boolean  // Was player in starting lineup
  position      String?  // Position player was started in
  createdAt     DateTime @default(now())

  league        League   @relation(fields: [leagueId], references: [id])
  player        Player   @relation(fields: [playerId], references: [id])

  @@unique([leagueId, playerId, week, season])
  @@map("player_weekly_scores")
}

model MatchupResult {
  id            String   @id @default(cuid())
  leagueId      String
  rosterId      Int      // Sleeper roster ID
  week          Int
  season        String
  matchupId     Int      // Matchup ID from Sleeper
  totalPoints   Float    // Team total points
  opponentId    Int?     // Opposing roster ID
  won           Boolean? // Did this roster win the matchup
  createdAt     DateTime @default(now())

  league        League   @relation(fields: [leagueId], references: [id])

  @@unique([leagueId, rosterId, week, season])
  @@map("matchup_results")
}
```

## Rate Limiting & Caching Strategy

### API Call Budget
- **Limit:** 1000 calls/minute
- **Strategy:** Implement 100ms delays (600 calls/minute buffer)
- **Priority:** Current week data > historical data

### Caching Approach
```javascript
const cacheStrategy = {
  // Cache forever
  permanent: [
    'completed seasons',
    'historical transactions', 
    'draft results'
  ],
  
  // Cache for 1 hour during season
  temporary: [
    'current week transactions',
    'active rosters',
    'NFL state'
  ],
  
  // Always fresh
  realtime: [
    'ongoing drafts',
    'pending trades'
  ]
};
```

## Real API Response Examples

### Failed Transaction
```json
{
  "status": "failed",
  "type": "waiver",
  "metadata": {
    "notes": "Unfortunately, your roster will have too many players after this transaction."
  },
  "created": 1756228510967,
  "transaction_id": "1266117778251726848"
}
```

### Draft Pick Only Trade
```json
{
  "type": "trade",
  "status": "complete", 
  "adds": null,
  "drops": null,
  "draft_picks": [
    {
      "round": 3,
      "season": "2027",
      "roster_id": 10,
      "owner_id": 7,
      "previous_owner_id": 10
    }
  ]
}
```

### Complex Scoring Settings (Sample)
```json
{
  "rec": 0.5,
  "bonus_rec_te": 1.0,
  "bonus_rec_wr": 0.5, 
  "rush_fd": 0.5,
  "rec_fd": 0.5,
  "pass_td": 4.0,
  "pass_td_40p": 0.0,
  "rush_td": 6.0,
  "rec_td": 6.0,
  "pass_int": -2.0,
  "fum_lost": -1.0,
  "sack": 1.0,
  "ff": 1.0
}
```

## Key Implementation Notes

1. **String Player IDs:** Always treat player IDs as strings, not integers
2. **Failed Transactions:** Include failed transactions in analysis - they show intent
3. **Week-Based Fetching:** Must fetch transactions by week (1-18) individually  
4. **Dynasty Continuity:** Follow `previous_league_id` chain for full history
5. **Three-Way Pick Tracking:** Essential for accurate trade chain reconstruction
6. **Timestamp Context:** Use NFL state for accurate dating of events
7. **No Individual Scoring:** Plan for external data integration from day one

## Conclusion

The Sleeper API provides excellent data for transaction tracking, roster management, and league structure analysis. However, individual player performance data requires external integration. The three-way draft pick tracking system is sophisticated and enables complete reconstruction of complex multi-hop trades.

The API's structure aligns well with Dynasty DNA's core mission of tracking the "genetic makeup" of roster construction through detailed transaction chain analysis.