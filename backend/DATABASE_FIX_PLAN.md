# Database Fix Plan - Critical Data Issues

## 🚨 Priority Issues to Address

### 1. DraftPick Model - Missing Historical Data
**Problem:**
- No records for 2021 (startup draft year) 
- Incomplete pickNumber and playerSelectedId for past seasons (2022-2024)
- Only tracking traded picks, not all draft picks

**Root Cause:**
- Current sync only captures traded draft picks from `/league/{id}/traded_picks` endpoint
- Need to sync actual draft data from `/drafts/{id}/picks` endpoint

**Solution:**
1. Sync all historical drafts using `/league/{id}/drafts` endpoint
2. For each draft, sync all picks using `/drafts/{id}/picks` 
3. Create DraftPick records for ALL picks, not just traded ones
4. Link picks to players selected

### 2. MatchupResult - Only Week 1 Data
**Problem:**
- Only 12 records per season (week 1 only)
- Should have ~17 weeks × 12 rosters = 204 records per season

**Root Cause:**
- `syncMatchups()` only syncing week 1 instead of all weeks

**Solution:**
1. Loop through weeks 1-17 (regular season + playoffs)
2. Call `/league/{id}/matchups/{week}` for each week
3. Store all matchup results

### 3. NFLState - Completely Empty
**Problem:**
- No NFL state data to determine game dates
- Critical for comparing transaction timestamps with game times

**Root Cause:**
- `getNFLState()` exists but never called during sync

**Solution:**
1. Call Sleeper's `/state/nfl` endpoint for each season
2. Store season start dates and week information
3. Update regularly during season

### 4. PlayerWeeklyScore - No Data
**Problem:**
- Empty table, no player scoring data
- Needed for performance analysis

**Solution:**
1. Extract from matchup data during sync
2. Parse `players_points` field from matchups
3. Store individual player scores per week

## 📋 Implementation Plan

### Step 1: Create Enhanced Data Sync Functions

#### A. Draft Data Sync
```typescript
async syncDrafts(leagueId: string): Promise<void> {
  // 1. Get all drafts for league
  const drafts = await sleeperClient.getLeagueDrafts(leagueId);
  
  // 2. For each draft:
  for (const draft of drafts) {
    // a. Create/update Draft record
    // b. Get all picks from draft
    const picks = await sleeperClient.getDraftPicks(draft.draft_id);
    
    // c. Create DraftPick records for ALL picks
    // d. Link to player selected
  }
  
  // 3. Handle startup drafts (2021)
  // Special handling for initial dynasty draft
}
```

#### B. Matchup Data Sync
```typescript
async syncAllMatchups(leagueId: string, season: string): Promise<void> {
  // Determine weeks based on season
  const maxWeek = season === '2025' ? 1 : 17;
  
  for (let week = 1; week <= maxWeek; week++) {
    const matchups = await sleeperClient.getLeagueMatchups(leagueId, week);
    
    // Store MatchupResult for each roster
    // Extract and store PlayerWeeklyScore data
  }
}
```

#### C. NFL State Sync
```typescript
async syncNFLState(): Promise<void> {
  const currentState = await sleeperClient.getNFLState();
  
  // Store current state
  // Also fetch and store historical states for past seasons
}
```

### Step 2: Update Seeding Scripts

1. Modify `seedDevData.ts`:
   - Add draft sync
   - Fix matchup sync to get all weeks
   - Add NFL state sync
   - Extract player scores from matchups

2. Create migration script for existing data:
   - Fix incomplete DraftPick records
   - Backfill missing matchups
   - Populate NFLState

### Step 3: Data Validation

Create validation script to ensure:
- All drafts have complete pick data
- All weeks have matchup data
- Player scores align with matchup totals
- NFLState has all seasons

## 🔧 File Changes Required

1. **backend/src/services/dataSyncService.ts**
   - Add `syncDrafts()` method
   - Fix `syncMatchups()` to loop all weeks
   - Add `syncNFLState()` method
   - Extract player scores during matchup sync

2. **backend/src/scripts/seedDevData.ts**
   - Call new sync methods
   - Add progress reporting for long syncs
   - Add validation checks

3. **backend/src/scripts/validateData.ts** (NEW)
   - Check data completeness
   - Report missing data
   - Verify data integrity

## 📊 Expected Data After Fix

### DraftPick Table
- 2021: ~144 records (12 teams × 12 rounds startup)
- 2022-2024: ~60 records each (12 teams × 5 rounds)
- 2025: ~60 records (partial, in progress)
- All past drafts should have pickNumber and playerSelectedId

### MatchupResult Table
- 2021-2024: ~204 records each (12 rosters × 17 weeks)
- 2025: 12 records (week 1 only, season in progress)

### NFLState Table
- 5 records (2021-2025)
- Each with season dates and week info

### PlayerWeeklyScore Table
- Thousands of records (all players × all weeks)
- Linked to matchups and rosters

## ⏱️ Timeline

**Day 1 (Today):**
1. Implement draft sync
2. Fix matchup sync
3. Add NFL state sync

**Day 2:**
1. Run full data sync
2. Validate data completeness
3. Test transaction graph with complete data

## 🎯 Success Criteria

1. ✅ All past drafts have complete pick data
2. ✅ All weeks have matchup results
3. ✅ NFL state populated for all seasons
4. ✅ Player scores extracted and stored
5. ✅ Transaction graph shows accurate draft pick paths
6. ✅ No null pickNumber/playerSelectedId for completed drafts

## 🚀 Next Steps After Fix

Once data is complete:
1. Transaction graph will show accurate draft pick associations
2. Can build player performance visualizations
3. Can analyze trade effectiveness with real scoring data
4. Can compare transaction times with game times