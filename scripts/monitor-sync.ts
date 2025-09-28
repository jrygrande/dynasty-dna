#!/usr/bin/env tsx
/**
 * Production monitoring script for Dynasty DNA sync system
 * Monitors sync performance, detects issues, and provides alerts
 */

import { getDb } from '../src/db/index';
import { sql } from 'drizzle-orm';

interface SyncMetrics {
  totalLeagues: number;
  recentlySynced: number;
  currentlySyncing: number;
  failedSyncs: number;
  staleLeagues: number;
  avgSyncDuration: number;
  lastSyncErrors: string[];
}

interface SyncAlert {
  type: 'warning' | 'error' | 'info';
  message: string;
  details?: any;
}

class SyncMonitor {
  private alerts: SyncAlert[] = [];

  private addAlert(type: SyncAlert['type'], message: string, details?: any) {
    this.alerts.push({ type, message, details });
    const emoji = type === 'error' ? '🚨' : type === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${emoji} ${message}`);
    if (details) {
      console.log('   Details:', details);
    }
  }

  async getSyncMetrics(): Promise<SyncMetrics> {
    const db = await getDb();

    // Get basic league counts
    const leagueCounts = await db.execute(sql`
      SELECT
        COUNT(*) as total_leagues,
        COUNT(CASE WHEN sync_status = 'syncing' THEN 1 END) as currently_syncing,
        COUNT(CASE WHEN sync_status = 'failed' THEN 1 END) as failed_syncs,
        COUNT(CASE WHEN last_sync_at > NOW() - INTERVAL '6 hours' THEN 1 END) as recently_synced
      FROM leagues
    `);

    const counts = leagueCounts[0] as any;

    // Calculate stale leagues (no sync in last 24 hours during NFL season)
    const now = new Date();
    const month = now.getMonth();
    const isNFLSeason = month >= 8 || month <= 0;
    const staleThreshold = isNFLSeason ? '6 hours' : '24 hours';

    const staleLeagues = await db.execute(sql`
      SELECT COUNT(*) as stale_count
      FROM leagues
      WHERE last_sync_at < NOW() - INTERVAL ${staleThreshold}
        OR last_sync_at IS NULL
    `);

    // Get recent job performance
    const jobMetrics = await db.execute(sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) as avg_duration_seconds,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END) as error_count
      FROM job_runs
      WHERE type = 'league_sync'
        AND started_at > NOW() - INTERVAL '24 hours'
        AND finished_at IS NOT NULL
    `);

    const jobStats = jobMetrics[0] as any;

    // Get recent sync errors
    const recentErrors = await db.execute(sql`
      SELECT error
      FROM job_runs
      WHERE type = 'league_sync'
        AND error IS NOT NULL
        AND started_at > NOW() - INTERVAL '24 hours'
      ORDER BY started_at DESC
      LIMIT 5
    `);

    return {
      totalLeagues: Number(counts.total_leagues),
      recentlySynced: Number(counts.recently_synced),
      currentlySyncing: Number(counts.currently_syncing),
      failedSyncs: Number(counts.failed_syncs),
      staleLeagues: Number(staleLeagues[0].stale_count),
      avgSyncDuration: Number(jobStats.avg_duration_seconds) || 0,
      lastSyncErrors: recentErrors.map((row: any) => row.error).filter(Boolean)
    };
  }

  async checkSyncHealth(metrics: SyncMetrics): Promise<void> {
    // Check for high failure rate
    const failureRate = (metrics.failedSyncs / metrics.totalLeagues) * 100;
    if (failureRate > 10) {
      this.addAlert('error', `High sync failure rate: ${failureRate.toFixed(1)}%`, {
        failedSyncs: metrics.failedSyncs,
        totalLeagues: metrics.totalLeagues
      });
    }

    // Check for too many stale leagues
    const staleRate = (metrics.staleLeagues / metrics.totalLeagues) * 100;
    if (staleRate > 25) {
      this.addAlert('warning', `Many leagues have stale data: ${staleRate.toFixed(1)}%`, {
        staleLeagues: metrics.staleLeagues,
        totalLeagues: metrics.totalLeagues
      });
    }

    // Check for stuck syncs
    if (metrics.currentlySyncing > 5) {
      this.addAlert('warning', `Many syncs in progress: ${metrics.currentlySyncing}`, {
        currentlySyncing: metrics.currentlySyncing
      });
    }

    // Check for slow syncs
    if (metrics.avgSyncDuration > 300) { // 5 minutes
      this.addAlert('warning', `Slow sync performance: ${(metrics.avgSyncDuration / 60).toFixed(1)} minutes average`, {
        avgSyncDuration: metrics.avgSyncDuration
      });
    }

    // Check for recent errors
    if (metrics.lastSyncErrors.length > 0) {
      this.addAlert('info', `${metrics.lastSyncErrors.length} sync errors in last 24 hours`, {
        errors: metrics.lastSyncErrors
      });
    }
  }

  async checkDatabaseHealth(): Promise<void> {
    const db = await getDb();

    try {
      // Check connection
      await db.execute(sql`SELECT 1`);

      // Check table sizes
      const tableSizes = await db.execute(sql`
        SELECT
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('leagues', 'transactions', 'matchups', 'player_scores', 'asset_events')
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      `);

      console.log('\n📊 Database Table Sizes:');
      tableSizes.forEach((row: any) => {
        console.log(`  ${row.tablename}: ${row.size}`);
      });

      // Check for very large tables (>1GB)
      const largeTables = tableSizes.filter((row: any) => row.size_bytes > 1024 * 1024 * 1024);
      if (largeTables.length > 0) {
        this.addAlert('info', 'Large database tables detected', {
          largeTables: largeTables.map((t: any) => `${t.tablename}: ${t.size}`)
        });
      }

      // Check for recent activity
      const recentActivity = await db.execute(sql`
        SELECT
          'transactions' as table_name,
          COUNT(*) as recent_records
        FROM transactions
        WHERE created_at > NOW() - INTERVAL '24 hours'
        UNION ALL
        SELECT
          'player_scores' as table_name,
          COUNT(*) as recent_records
        FROM player_scores
        WHERE league_id IN (
          SELECT id FROM leagues WHERE last_sync_at > NOW() - INTERVAL '24 hours'
        )
      `);

      console.log('\n📈 Recent Database Activity (24h):');
      recentActivity.forEach((row: any) => {
        console.log(`  ${row.table_name}: ${row.recent_records} records`);
      });

    } catch (error) {
      this.addAlert('error', 'Database connection failed', { error: String(error) });
    }
  }

  async checkAPIHealth(): Promise<void> {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';

    try {
      // Check health endpoint
      const healthResponse = await fetch(`${baseUrl}/api/health`, { timeout: 5000 });
      if (!healthResponse.ok) {
        this.addAlert('error', 'Health endpoint failed', {
          status: healthResponse.status,
          statusText: healthResponse.statusText
        });
      }

      // Check sync endpoints with invalid data (should fail gracefully)
      const invalidSyncResponse = await fetch(`${baseUrl}/api/sync/check-staleness?leagueId=invalid`, {
        timeout: 5000
      });

      if (invalidSyncResponse.status !== 400) {
        this.addAlert('warning', 'Sync endpoint validation may be broken', {
          expectedStatus: 400,
          actualStatus: invalidSyncResponse.status
        });
      }

    } catch (error) {
      this.addAlert('error', 'API health check failed', { error: String(error) });
    }
  }

  async findStuckSyncs(): Promise<void> {
    const db = await getDb();

    // Find syncs that have been "syncing" for more than 30 minutes
    const stuckSyncs = await db.execute(sql`
      SELECT
        jr.id,
        jr.ref as league_id,
        jr.started_at,
        jr.total,
        jr.done,
        EXTRACT(EPOCH FROM (NOW() - jr.started_at)) / 60 as minutes_running
      FROM job_runs jr
      JOIN leagues l ON l.id = jr.ref
      WHERE jr.type = 'league_sync'
        AND jr.status = 'running'
        AND jr.started_at < NOW() - INTERVAL '30 minutes'
        AND l.sync_status = 'syncing'
      ORDER BY jr.started_at ASC
    `);

    if (stuckSyncs.length > 0) {
      this.addAlert('error', `${stuckSyncs.length} stuck sync jobs detected`, {
        stuckJobs: stuckSyncs.map((job: any) => ({
          leagueId: job.league_id,
          minutesRunning: Math.round(job.minutes_running),
          progress: `${job.done}/${job.total}`
        }))
      });

      console.log('\n🔧 Stuck Sync Jobs:');
      stuckSyncs.forEach((job: any) => {
        console.log(`  League ${job.league_id}: ${Math.round(job.minutes_running)} minutes, ${job.done}/${job.total} complete`);
      });
    }
  }

  async generateReport(): Promise<void> {
    console.log('🔍 Dynasty DNA Sync System Health Report');
    console.log('=======================================');
    console.log(`Generated at: ${new Date().toISOString()}\n`);

    const metrics = await getSyncMetrics();

    console.log('📊 Sync Metrics:');
    console.log(`  Total Leagues: ${metrics.totalLeagues}`);
    console.log(`  Recently Synced (6h): ${metrics.recentlySynced}`);
    console.log(`  Currently Syncing: ${metrics.currentlySyncing}`);
    console.log(`  Failed Syncs: ${metrics.failedSyncs}`);
    console.log(`  Stale Leagues: ${metrics.staleLeagues}`);
    console.log(`  Avg Sync Duration: ${(metrics.avgSyncDuration / 60).toFixed(1)} minutes`);

    await this.checkSyncHealth(metrics);
    await this.findStuckSyncs();
    await this.checkDatabaseHealth();
    await this.checkAPIHealth();

    // Summary
    const errorCount = this.alerts.filter(a => a.type === 'error').length;
    const warningCount = this.alerts.filter(a => a.type === 'warning').length;

    console.log(`\n🎯 Health Summary: ${errorCount} errors, ${warningCount} warnings`);

    if (errorCount > 0) {
      console.log('\n🚨 Critical Issues Found - Immediate attention required!');
    } else if (warningCount > 0) {
      console.log('\n⚠️ Some issues detected - Monitor closely');
    } else {
      console.log('\n✅ System appears healthy');
    }
  }
}

// Helper function to get sync metrics without the class
async function getSyncMetrics(): Promise<SyncMetrics> {
  const monitor = new SyncMonitor();
  return await monitor.getSyncMetrics();
}

// Main execution
async function main() {
  const command = process.argv[2] || 'report';

  try {
    const monitor = new SyncMonitor();

    switch (command) {
      case 'metrics':
        const metrics = await monitor.getSyncMetrics();
        console.log(JSON.stringify(metrics, null, 2));
        break;

      case 'stuck':
        await monitor.findStuckSyncs();
        break;

      case 'db':
        await monitor.checkDatabaseHealth();
        break;

      case 'api':
        await monitor.checkAPIHealth();
        break;

      default:
        await monitor.generateReport();
        break;
    }
  } catch (error) {
    console.error('❌ Monitoring failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { SyncMonitor, getSyncMetrics };