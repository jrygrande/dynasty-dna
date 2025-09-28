# Dynasty DNA Sync System Testing Guide

## Overview
This document outlines the comprehensive testing strategy for the Dynasty DNA automatic data sync system, including the acquisition type fixes and intelligent sync middleware.

## Test Scripts Created

### 1. Comprehensive Sync Tests (`scripts/test-sync.ts`)
**Usage:** `tsx scripts/test-sync.ts [LEAGUE_ID]`

Tests all major sync system components:
- ✅ Acquisition type priority (trade > add)
- ✅ Sync status tracking (idle → syncing → idle/failed)
- ✅ Staleness detection with various thresholds
- ✅ Incremental vs full sync performance
- ✅ API endpoint functionality

**Expected Results:**
- All traded players should show 'trade' acquisition type
- Sync status transitions should work correctly
- Incremental sync should be faster than full sync
- Staleness detection should respect thresholds

### 2. Load Testing (`scripts/load-test-sync.ts`)
**Usage:** `tsx scripts/load-test-sync.ts [LEAGUE_ID]`

Tests system behavior under load:
- ✅ Concurrent sync request handling
- ✅ Race condition prevention
- ✅ Progressive concurrency scaling
- ✅ Error handling and recovery

**Expected Results:**
- Only one sync should execute at a time per league
- API should handle concurrent requests gracefully
- Error responses should be appropriate

### 3. Database Validation (`scripts/test-db-queries.ts`)
**Usage:** `tsx scripts/test-db-queries.ts`

Tests database schema and data integrity:
- ✅ New sync tracking columns exist
- ✅ Acquisition type data quality
- ✅ Index performance
- ✅ Sync status distribution

**Expected Results:**
- All sync columns should be present
- No trade/add conflicts in acquisition types
- Queries should execute quickly

### 4. Production Monitoring (`scripts/monitor-sync.ts`)
**Usage:** `tsx scripts/monitor-sync.ts [command]`

Commands:
- `report` - Full health report (default)
- `metrics` - JSON metrics output
- `stuck` - Find stuck sync jobs
- `db` - Database health check
- `api` - API endpoint health check

## Test Scenarios

### Manual Testing Checklist

#### ✅ Fresh League (Never Synced)
1. Access `/roster?leagueId=NEW_LEAGUE&rosterId=1`
2. Verify middleware triggers background sync
3. Check sync status updates to 'syncing' then 'idle'
4. Confirm data appears correctly

#### ✅ Recently Synced League (< 1 hour)
1. Access roster page for recently synced league
2. Verify no new sync is triggered
3. Data should load immediately

#### ✅ Stale League (NFL Season, > 3 hours)
1. Access roster page during NFL season
2. Verify background sync is triggered
3. Page should load with existing data while sync runs

#### ✅ Stale League (Off-season, > 24 hours)
1. Access roster page during off-season
2. Verify background sync triggered only if very stale
3. Different threshold applied correctly

#### ✅ Failed Sync Recovery
1. Cause a sync to fail (invalid API key, network error)
2. Verify status marked as 'failed'
3. Next page access should retry sync

#### ✅ Concurrent Access Prevention
1. Start a manual sync via API
2. Access pages that would trigger middleware
3. Verify no duplicate syncs start

### Acquisition Type Testing

#### ✅ Trade vs Add Priority
```sql
-- Find players with both trade and add events
SELECT
  player_id,
  array_agg(DISTINCT event_type) as event_types,
  COUNT(DISTINCT event_type) as type_count
FROM asset_events
WHERE asset_kind = 'player'
  AND event_type IN ('trade', 'add')
GROUP BY player_id
HAVING COUNT(DISTINCT event_type) > 1;
```

Expected: Zero results or all players correctly show 'trade' in roster API

#### ✅ Roster API Response
```bash
curl "http://localhost:3000/api/roster/1?leagueId=LEAGUE_ID" | \
  jq '.currentAssets.players[] | select(.acquisitionType == "add")'
```

Expected: No players who were traded should show 'add' type

### Performance Benchmarks

#### ✅ Sync Duration Targets
- **Incremental Sync:** < 30 seconds for active leagues
- **Full Sync:** < 2 minutes for most leagues
- **Staleness Check:** < 100ms response time
- **Background Sync Trigger:** < 50ms overhead

#### ✅ Database Query Performance
- **Sync Status Check:** < 10ms
- **Staleness Detection:** < 50ms
- **Acquisition Type Priority:** No measurable impact

### Middleware Testing

#### ✅ Route Coverage
Test middleware on these routes:
- `/roster?leagueId=X&rosterId=Y`
- `/player-scoring?leagueId=X&playerId=Y`

#### ✅ Non-Blocking Behavior
```bash
# Time page load - should be < 200ms even with sync trigger
time curl -I "http://localhost:3000/roster?leagueId=LEAGUE_ID&rosterId=1"
```

#### ✅ Smart Thresholds
- **Sunday 2PM (NFL game time):** 1-hour threshold
- **Tuesday 10AM (off-season):** 24-hour threshold
- **Thursday 8PM (game day):** 1-hour threshold
- **Wednesday 9AM (season):** 6-hour threshold

## Environment Setup

### Required Environment Variables
```bash
# For database tests
DATABASE_URL=postgresql://user:pass@host/db

# For API tests
TEST_LEAGUE_ID=1234567890123456
NEXTAUTH_URL=http://localhost:3000

# For production monitoring
NODE_ENV=production
```

### Development Testing
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run comprehensive tests
tsx scripts/test-sync.ts $TEST_LEAGUE_ID

# Run load tests
tsx scripts/load-test-sync.ts $TEST_LEAGUE_ID

# Monitor sync health
tsx scripts/monitor-sync.ts
```

### Production Testing
```bash
# Check system health
tsx scripts/monitor-sync.ts report

# Get metrics for external monitoring
tsx scripts/monitor-sync.ts metrics

# Find stuck syncs
tsx scripts/monitor-sync.ts stuck
```

## Troubleshooting

### Common Issues

#### ❌ "DATABASE_URL is not set"
- Set DATABASE_URL environment variable
- Check .env file exists and is loaded

#### ❌ "TEST_LEAGUE_ID required"
- Provide league ID as argument or environment variable
- Use a league with existing data for best results

#### ❌ Sync stuck in 'syncing' status
- Run: `tsx scripts/monitor-sync.ts stuck`
- Check job_runs table for errors
- Manually reset status if needed

#### ❌ High memory usage during sync
- Check for memory leaks in sync service
- Monitor database connection pooling
- Consider reducing batch sizes

### Performance Issues

#### 🐌 Slow sync performance
1. Check database indexes
2. Monitor Sleeper API rate limits
3. Review network latency
4. Consider incremental sync only

#### 🔄 Too many background syncs
1. Verify staleness thresholds are appropriate
2. Check middleware is not triggering on every request
3. Monitor sync_status to prevent duplicates

## Success Criteria

### ✅ Functional Requirements
- [x] Acquisition types correctly prioritize trade > add
- [x] Middleware detects stale data intelligently
- [x] Background syncs don't block page loads
- [x] Incremental syncs reduce API calls and time
- [x] Sync status prevents concurrent operations
- [x] Failed syncs can recover automatically

### ✅ Performance Requirements
- [x] Page load impact < 50ms
- [x] Staleness check < 100ms
- [x] Incremental sync 50%+ faster than full
- [x] No memory leaks during extended operation

### ✅ Reliability Requirements
- [x] Handles Sleeper API failures gracefully
- [x] Database connection issues don't crash app
- [x] Middleware errors don't block page access
- [x] Sync system recovers from failures automatically

## Monitoring in Production

### Key Metrics to Track
- Sync success/failure rates
- Average sync duration by type
- Staleness threshold effectiveness
- Middleware trigger frequency
- Database query performance

### Alerts to Configure
- High sync failure rate (>10%)
- Stuck syncs (>30 minutes)
- Many stale leagues (>25%)
- Slow sync performance (>5 minutes avg)
- Database connection issues

### Regular Health Checks
- Run `monitor-sync.ts report` daily
- Check for acquisition type data quality weekly
- Review sync patterns during NFL season vs off-season
- Monitor database growth and cleanup old data