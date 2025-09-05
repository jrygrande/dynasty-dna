# Draft Pick Association Fix Plan

## Current State Analysis

### Manual Fixes Applied
1. **Gibbs transaction** - Manually updated to use correct draft pick
2. **Cam Skattebo transaction** - Manually added missing draft pick association

### Will Re-sync Produce Correct Data?

**Partially, but not completely.** Here's the breakdown:

#### ✅ What WILL Work on Re-sync:
1. **Re-acquired picks** - Code fix for `previousOwnerId != null` will correctly associate draft picks
2. **Draft descriptions** - All draft transactions will get proper "Draft selection by X" descriptions  
3. **Validation** - Duplicate draft pick associations will be prevented

#### ❌ What WON'T Work on Re-sync:
1. **Multiple picks in same round** - The `findCorrectDraftPick` method uses "best guess" strategies that can't definitively determine which pick was used
2. **Missing draft_pick records** - We only create draft_picks for traded picks, not original non-traded picks

## Root Problems

1. **Incomplete draft_pick data model** - We need ALL draft picks to exist, not just traded ones
2. **No definitive pick matching** - Without tracking draft_slot → draft_pick mapping, we can't be 100% certain which pick was used
3. **Missing Sleeper API integration** - We're not using `/draft/<id>/picks` and `/draft/<id>/traded_picks` endpoints effectively

## Comprehensive Solution

### 1. Create ALL Draft Picks (Not Just Traded)
- When syncing a league, create 48 draft_picks per season (12 teams × 4 rounds)
- Set originalOwner = currentOwner for never-traded picks
- Use roster positions to determine original ownership

### 2. Improve Draft Pick Matching
- Store draft_slot in draft_picks table (add migration)
- Match selections to picks using draft_slot as primary key
- Use pick trading history from Sleeper's `/draft/<id>/traded_picks` endpoint

### 3. Integration with Sleeper Draft Endpoints

```typescript
// Fetch actual draft picks
const picks = await sleeperClient.getDraftPicks(draftId);
// Fetch traded picks
const tradedPicks = await sleeperClient.getTradedPicks(draftId);

// Create base picks (all 48)
await createBaseDraftPicks(season, league);
// Update with trade info
await updateTradedPicks(tradedPicks);
// Match selections to picks
await matchSelectionsToPicks(picks, selections);
```

### 4. Data Migration Strategy
- Add `draftSlot` column to draft_picks table
- Populate existing draft_picks with correct draft_slot
- Create missing original (non-traded) draft_picks
- Re-associate draft transactions using draft_slot matching

### 5. Testing & Validation
- Clear database and full re-sync to verify
- Test cases: 
  - Gibbs (traded pick)
  - JSN (original pick that should exist)
  - Skattebo (re-acquired pick)
- Ensure no duplicate associations
- Verify all draft transactions have assetsGiven

## Implementation Steps

### Step 1: Update Schema
```prisma
model DraftPick {
  // ... existing fields ...
  draftSlot    Int?     // Add this field
}
```

### Step 2: Update Sleeper Client
Add methods to fetch draft picks and traded picks:
```typescript
async getDraftPicks(draftId: string)
async getTradedPicks(draftId: string) 
```

### Step 3: Create Base Draft Picks
```typescript
async createAllDraftPicks(season: string, leagueId: string) {
  // Create 48 picks (12 teams × 4 rounds)
  // Use roster positions for original ownership
}
```

### Step 4: Update Sync Logic
- First create all base picks
- Then apply traded pick updates
- Finally match selections to picks using draft_slot

### Step 5: Migration Script
- Identify and create missing draft_picks
- Update draft_slot for existing picks
- Re-associate transaction items

## Expected Outcome

After implementing this plan:
- **No manual database fixes needed**
- **100% accurate draft pick associations**
- **Clean re-sync produces correct data**
- **All draft transactions show proper assetsGiven**

## Test Verification

Run these queries after implementation:
```sql
-- All draft picks should exist
SELECT season, round, COUNT(*) FROM draft_picks 
GROUP BY season, round;
-- Should show 12 picks per round

-- No duplicate associations
SELECT draftPickId, COUNT(*) as usage_count 
FROM transaction_items 
WHERE draftPickId IS NOT NULL 
GROUP BY draftPickId 
HAVING usage_count > 1;
-- Should return 0 rows

-- All draft transactions have picks
SELECT COUNT(*) FROM transactions t
LEFT JOIN transaction_items ti 
  ON t.id = ti.transactionId AND ti.type = 'drop'
WHERE t.type = 'draft' AND ti.id IS NULL;
-- Should return 0 (except startup drafts)
```

## Recommendation

**Don't rely on re-sync with current code.** The current implementation has fundamental limitations that require manual fixes. Implement this comprehensive solution to ensure data integrity and eliminate manual interventions.