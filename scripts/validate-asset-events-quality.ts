#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

interface ValidationResult {
  check: string;
  status: 'pass' | 'fail' | 'warning';
  count?: number;
  description: string;
  details?: any[];
}

async function validateAssetEventsQuality(leagueId?: string) {
  console.log('🔍 Validating asset events data quality...\n');
  const db = await getDb();
  const results: ValidationResult[] = [];

  // Build the base WHERE clause
  const whereClause = leagueId
    ? sql`WHERE league_id = ${leagueId}`
    : sql`WHERE 1=1`;

  const leagueFilter = leagueId ? `for league ${leagueId}` : 'across all leagues';

  try {
    // 1. Check for events with missing essential data
    console.log('Checking for events with missing essential data...');
    const missingDataCheck = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM asset_events
      ${whereClause}
        AND (
          league_id IS NULL OR
          event_type IS NULL OR
          asset_kind IS NULL OR
          (asset_kind = 'player' AND player_id IS NULL) OR
          (asset_kind = 'pick' AND (pick_season IS NULL OR pick_round IS NULL))
        )
    `);

    const missingDataCount = Number(missingDataCheck.rows[0]?.count || 0);
    results.push({
      check: 'missing_essential_data',
      status: missingDataCount === 0 ? 'pass' : 'fail',
      count: missingDataCount,
      description: `Events with missing essential data ${leagueFilter}`
    });

    // 2. Check for orphaned player references
    console.log('Checking for orphaned player references...');
    const orphanedPlayersCheck = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM asset_events ae
      LEFT JOIN players p ON ae.player_id = p.id
      ${whereClause}
        AND ae.asset_kind = 'player'
        AND ae.player_id IS NOT NULL
        AND p.id IS NULL
    `);

    const orphanedPlayersCount = Number(orphanedPlayersCheck.rows[0]?.count || 0);
    results.push({
      check: 'orphaned_players',
      status: orphanedPlayersCount === 0 ? 'pass' : 'warning',
      count: orphanedPlayersCount,
      description: `Events referencing non-existent players ${leagueFilter}`
    });

    // 3. Check for events with invalid time ranges
    console.log('Checking for events with invalid time ranges...');
    const invalidTimeCheck = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM asset_events
      ${whereClause}
        AND event_time IS NOT NULL
        AND (
          event_time < '2020-01-01'::timestamp OR
          event_time > '2030-01-01'::timestamp
        )
    `);

    const invalidTimeCount = Number(invalidTimeCheck.rows[0]?.count || 0);
    results.push({
      check: 'invalid_time_ranges',
      status: invalidTimeCount === 0 ? 'pass' : 'warning',
      count: invalidTimeCount,
      description: `Events with implausible event times ${leagueFilter}`
    });

    // 4. Check for duplicate events (should be zero with constraint)
    console.log('Checking for duplicate events...');
    const duplicatesCheck = await db.execute(sql`
      SELECT COUNT(*) as duplicate_groups
      FROM (
        SELECT
          league_id,
          event_type,
          asset_kind,
          player_id,
          pick_season,
          pick_round,
          pick_original_roster_id,
          transaction_id,
          from_user_id,
          to_user_id,
          COUNT(*) as duplicate_count
        FROM asset_events
        ${whereClause}
        GROUP BY
          league_id,
          event_type,
          asset_kind,
          player_id,
          pick_season,
          pick_round,
          pick_original_roster_id,
          transaction_id,
          from_user_id,
          to_user_id
        HAVING COUNT(*) > 1
      ) duplicate_check
    `);

    const duplicatesCount = Number(duplicatesCheck.rows[0]?.duplicate_groups || 0);
    results.push({
      check: 'duplicate_events',
      status: duplicatesCount === 0 ? 'pass' : 'fail',
      count: duplicatesCount,
      description: `Duplicate event groups ${leagueFilter}`
    });

    // 5. Check for events without transaction context where expected
    console.log('Checking for events missing transaction context...');
    const missingTransactionCheck = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM asset_events
      ${whereClause}
        AND event_type IN ('trade', 'waiver_add', 'waiver_drop', 'free_agent_add', 'free_agent_drop', 'pick_trade')
        AND transaction_id IS NULL
    `);

    const missingTransactionCount = Number(missingTransactionCheck.rows[0]?.count || 0);
    results.push({
      check: 'missing_transaction_context',
      status: missingTransactionCount === 0 ? 'pass' : 'warning',
      count: missingTransactionCount,
      description: `Transaction-based events missing transaction_id ${leagueFilter}`
    });

    // 6. Check data distribution
    console.log('Checking data distribution by event type...');
    const distributionCheck = await db.execute(sql`
      SELECT
        event_type,
        asset_kind,
        COUNT(*) as count
      FROM asset_events
      ${whereClause}
      GROUP BY event_type, asset_kind
      ORDER BY count DESC
    `);

    results.push({
      check: 'data_distribution',
      status: 'pass',
      description: `Event type distribution ${leagueFilter}`,
      details: distributionCheck.rows
    });

    // 7. Check for recent activity
    console.log('Checking for recent activity...');
    const recentActivityCheck = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM asset_events
      ${whereClause}
        AND created_at >= NOW() - INTERVAL '7 days'
    `);

    const recentActivityCount = Number(recentActivityCheck.rows[0]?.count || 0);
    results.push({
      check: 'recent_activity',
      status: recentActivityCount > 0 ? 'pass' : 'warning',
      count: recentActivityCount,
      description: `Events created in the last 7 days ${leagueFilter}`
    });

    // 8. Check consistency between asset events and transactions
    console.log('Checking consistency with transactions table...');
    const consistencyCheck = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM asset_events ae
      LEFT JOIN transactions t ON ae.transaction_id = t.id
      ${whereClause}
        AND ae.transaction_id IS NOT NULL
        AND t.id IS NULL
    `);

    const consistencyCount = Number(consistencyCheck.rows[0]?.count || 0);
    results.push({
      check: 'transaction_consistency',
      status: consistencyCount === 0 ? 'pass' : 'warning',
      count: consistencyCount,
      description: `Events referencing non-existent transactions ${leagueFilter}`
    });

  } catch (error: any) {
    console.error('❌ Error during validation:', error.message);
    results.push({
      check: 'validation_error',
      status: 'fail',
      description: `Validation failed: ${error.message}`
    });
  }

  // Print results
  console.log('\n📊 Data Quality Validation Results:');
  console.log('══════════════════════════════════════');

  let totalIssues = 0;
  for (const result of results) {
    const status = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    const countStr = result.count !== undefined ? ` (${result.count})` : '';

    console.log(`${status} ${result.description}${countStr}`);

    if (result.status === 'fail') {
      totalIssues += result.count || 1;
    }

    // Show distribution details
    if (result.check === 'data_distribution' && result.details) {
      console.log('   Distribution breakdown:');
      for (const detail of result.details.slice(0, 10)) { // Show top 10
        console.log(`     ${detail.event_type} (${detail.asset_kind}): ${detail.count}`);
      }
    }
  }

  console.log('══════════════════════════════════════');

  if (totalIssues === 0) {
    console.log('🎉 Data quality validation passed! No critical issues found.');
  } else {
    console.log(`⚠️  Found ${totalIssues} critical issue(s) that should be addressed.`);
  }

  return results;
}

async function main() {
  const leagueId = process.argv[2]; // Optional league ID filter

  if (leagueId) {
    console.log(`🔍 Validating asset events quality for league: ${leagueId}\n`);
  } else {
    console.log('🔍 Validating asset events quality for all leagues\n');
  }

  try {
    const results = await validateAssetEventsQuality(leagueId);

    // Exit with error code if there are critical failures
    const criticalFailures = results.filter(r => r.status === 'fail').length;
    process.exit(criticalFailures > 0 ? 1 : 0);

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});