#!/usr/bin/env tsx
/**
 * Comprehensive test script for the Dynasty DNA sync system
 * Tests acquisition type fixes, sync status tracking, staleness detection, and performance
 */

import { isLeagueDataStale, updateLeagueSyncStatus, getLeagueSyncInfo } from '../src/repositories/leagues';
import { syncLeague } from '../src/services/sync';
import { getDb } from '../src/db/index';
import { sql } from 'drizzle-orm';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration?: number;
}

class SyncTester {
  private testLeagueId: string;
  private results: TestResult[] = [];

  constructor(leagueId?: string) {
    this.testLeagueId = leagueId || process.env.TEST_LEAGUE_ID || '';
    if (!this.testLeagueId) {
      throw new Error('TEST_LEAGUE_ID environment variable or parameter required');
    }
  }

  private addResult(name: string, passed: boolean, details: string, duration?: number) {
    this.results.push({ name, passed, details, duration });
    const status = passed ? '✅' : '❌';
    const durationStr = duration ? ` (${duration}ms)` : '';
    console.log(`${status} ${name}: ${details}${durationStr}`);
  }

  async testAcquisitionTypePriority(): Promise<void> {
    console.log('\n🔍 Testing Acquisition Type Priority...');

    try {
      const db = await getDb();

      // Find players with both trade and add events
      const duplicateEvents = await db.execute(sql`
        SELECT
          player_id,
          array_agg(DISTINCT event_type ORDER BY event_type) as event_types,
          COUNT(DISTINCT event_type) as type_count
        FROM asset_events
        WHERE asset_kind = 'player'
          AND league_id = ${this.testLeagueId}
          AND event_type IN ('trade', 'add', 'waiver_add', 'free_agent_add')
        GROUP BY player_id
        HAVING COUNT(DISTINCT event_type) > 1
        LIMIT 5
      `);

      if (duplicateEvents.length === 0) {
        this.addResult(
          'Acquisition Type Priority',
          true,
          'No duplicate events found - good data integrity'
        );
        return;
      }

      // Test the roster endpoint to see if it correctly prioritizes trade events
      const response = await fetch(`http://localhost:3000/api/roster/1?leagueId=${this.testLeagueId}`);
      const rosterData = await response.json();

      if (!rosterData.ok) {
        this.addResult(
          'Acquisition Type Priority',
          false,
          `Failed to fetch roster data: ${rosterData.error}`
        );
        return;
      }

      // Check if any players that have trade events show 'add' as acquisition type
      const players = rosterData.currentAssets?.players || [];
      const tradePlayerIds = new Set(
        duplicateEvents
          .filter((row: any) => row.event_types.includes('trade'))
          .map((row: any) => row.player_id)
      );

      const incorrectAcquisitions = players.filter((player: any) =>
        tradePlayerIds.has(player.id) && player.acquisitionType === 'add'
      );

      this.addResult(
        'Acquisition Type Priority',
        incorrectAcquisitions.length === 0,
        incorrectAcquisitions.length === 0
          ? 'All traded players correctly show trade acquisition type'
          : `${incorrectAcquisitions.length} players incorrectly show 'add' instead of 'trade'`
      );

    } catch (error) {
      this.addResult(
        'Acquisition Type Priority',
        false,
        `Error: ${error}`
      );
    }
  }

  async testSyncStatusTracking(): Promise<void> {
    console.log('\n📊 Testing Sync Status Tracking...');

    try {
      // Get initial status
      const initialStatus = await getLeagueSyncInfo(this.testLeagueId);

      this.addResult(
        'Initial Sync Status',
        initialStatus !== null,
        initialStatus ? `Status: ${initialStatus.syncStatus}` : 'No sync info found'
      );

      // Test status update to syncing
      await updateLeagueSyncStatus(this.testLeagueId, 'syncing');
      const syncingStatus = await getLeagueSyncInfo(this.testLeagueId);

      this.addResult(
        'Syncing Status Update',
        syncingStatus?.syncStatus === 'syncing',
        `Expected: syncing, Got: ${syncingStatus?.syncStatus}`
      );

      // Test status update to idle with timestamp
      const beforeIdle = new Date();
      await updateLeagueSyncStatus(this.testLeagueId, 'idle', beforeIdle);
      const idleStatus = await getLeagueSyncInfo(this.testLeagueId);

      this.addResult(
        'Idle Status Update',
        idleStatus?.syncStatus === 'idle' && idleStatus?.lastSyncAt !== null,
        `Status: ${idleStatus?.syncStatus}, LastSync: ${idleStatus?.lastSyncAt?.toISOString()}`
      );

      // Test failed status
      await updateLeagueSyncStatus(this.testLeagueId, 'failed');
      const failedStatus = await getLeagueSyncInfo(this.testLeagueId);

      this.addResult(
        'Failed Status Update',
        failedStatus?.syncStatus === 'failed',
        `Expected: failed, Got: ${failedStatus?.syncStatus}`
      );

      // Reset to idle
      await updateLeagueSyncStatus(this.testLeagueId, 'idle');

    } catch (error) {
      this.addResult(
        'Sync Status Tracking',
        false,
        `Error: ${error}`
      );
    }
  }

  async testStalenessDetection(): Promise<void> {
    console.log('\n⏰ Testing Staleness Detection...');

    try {
      // Test with fresh data (should not be stale)
      await updateLeagueSyncStatus(this.testLeagueId, 'idle', new Date());

      const notStale1Hr = await isLeagueDataStale(this.testLeagueId, 1);
      this.addResult(
        'Fresh Data (1hr threshold)',
        !notStale1Hr,
        `Expected: false, Got: ${notStale1Hr}`
      );

      // Test with old data (should be stale)
      const oldDate = new Date(Date.now() - (5 * 60 * 60 * 1000)); // 5 hours ago
      await updateLeagueSyncStatus(this.testLeagueId, 'idle', oldDate);

      const stale3Hr = await isLeagueDataStale(this.testLeagueId, 3);
      this.addResult(
        'Old Data (3hr threshold)',
        stale3Hr,
        `Expected: true, Got: ${stale3Hr}`
      );

      const notStale6Hr = await isLeagueDataStale(this.testLeagueId, 6);
      this.addResult(
        'Old Data (6hr threshold)',
        !notStale6Hr,
        `Expected: false, Got: ${notStale6Hr}`
      );

      // Test with no sync data
      const db = await getDb();
      await db.execute(sql`
        UPDATE leagues
        SET last_sync_at = NULL
        WHERE id = ${this.testLeagueId}
      `);

      const staleNoData = await isLeagueDataStale(this.testLeagueId, 24);
      this.addResult(
        'No Sync Data',
        staleNoData,
        `Expected: true (stale), Got: ${staleNoData}`
      );

    } catch (error) {
      this.addResult(
        'Staleness Detection',
        false,
        `Error: ${error}`
      );
    }
  }

  async testIncrementalVsFullSync(): Promise<void> {
    console.log('\n🏃‍♂️ Testing Incremental vs Full Sync Performance...');

    try {
      // Test incremental sync
      const incrementalStart = Date.now();
      const incrementalResult = await syncLeague(this.testLeagueId, { incremental: true });
      const incrementalDuration = Date.now() - incrementalStart;

      this.addResult(
        'Incremental Sync',
        true,
        `Synced ${incrementalResult.transactions} transactions, ${incrementalResult.playerScores} scores`,
        incrementalDuration
      );

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test full sync
      const fullStart = Date.now();
      const fullResult = await syncLeague(this.testLeagueId);
      const fullDuration = Date.now() - fullStart;

      this.addResult(
        'Full Sync',
        true,
        `Synced ${fullResult.transactions} transactions, ${fullResult.playerScores} scores`,
        fullDuration
      );

      // Compare performance
      const speedImprovement = ((fullDuration - incrementalDuration) / fullDuration * 100).toFixed(1);
      this.addResult(
        'Performance Comparison',
        incrementalDuration < fullDuration,
        `Incremental sync ${speedImprovement}% faster than full sync`
      );

    } catch (error) {
      this.addResult(
        'Sync Performance Test',
        false,
        `Error: ${error}`
      );
    }
  }

  async testAPIEndpoints(): Promise<void> {
    console.log('\n🌐 Testing API Endpoints...');

    try {
      // Test staleness check endpoint
      const stalenessResponse = await fetch(
        `http://localhost:3000/api/sync/check-staleness?leagueId=${this.testLeagueId}`
      );
      const stalenessData = await stalenessResponse.json();

      this.addResult(
        'Staleness Check API',
        stalenessResponse.ok && typeof stalenessData.isStale === 'boolean',
        `Response: ${JSON.stringify(stalenessData)}`
      );

      // Test background sync endpoint
      const backgroundResponse = await fetch(
        `http://localhost:3000/api/sync/league`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId: this.testLeagueId,
            background: true,
            incremental: true
          })
        }
      );
      const backgroundData = await backgroundResponse.json();

      this.addResult(
        'Background Sync API',
        backgroundResponse.ok && backgroundData.ok,
        `Response: ${backgroundData.message || backgroundData.error}`
      );

    } catch (error) {
      this.addResult(
        'API Endpoints Test',
        false,
        `Error: ${error}`
      );
    }
  }

  async runAllTests(): Promise<void> {
    console.log(`🧪 Starting Sync System Tests for League: ${this.testLeagueId}\n`);

    await this.testAcquisitionTypePriority();
    await this.testSyncStatusTracking();
    await this.testStalenessDetection();
    await this.testIncrementalVsFullSync();
    await this.testAPIEndpoints();

    // Summary
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const passRate = ((passed / total) * 100).toFixed(1);

    console.log(`\n📊 Test Summary: ${passed}/${total} tests passed (${passRate}%)`);

    if (passed < total) {
      console.log('\n❌ Failed Tests:');
      this.results
        .filter(r => !r.passed)
        .forEach(r => console.log(`  - ${r.name}: ${r.details}`));
    }

    // Performance summary
    console.log('\n⚡ Performance Summary:');
    this.results
      .filter(r => r.duration)
      .forEach(r => console.log(`  - ${r.name}: ${r.duration}ms`));
  }
}

// Main execution
async function main() {
  const leagueId = process.argv[2];

  if (!leagueId && !process.env.TEST_LEAGUE_ID) {
    console.error('Usage: tsx scripts/test-sync.ts [LEAGUE_ID]');
    console.error('Or set TEST_LEAGUE_ID environment variable');
    process.exit(1);
  }

  try {
    const tester = new SyncTester(leagueId);
    await tester.runAllTests();
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}