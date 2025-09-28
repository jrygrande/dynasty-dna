#!/usr/bin/env tsx
/**
 * Load testing script for Dynasty DNA sync system
 * Tests concurrent sync requests, rate limiting, and error handling
 */

import { performance } from 'perf_hooks';

interface LoadTestResult {
  concurrent: number;
  successful: number;
  failed: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  errors: string[];
}

class SyncLoadTester {
  private baseUrl: string;
  private testLeagueId: string;

  constructor(baseUrl: string = 'http://localhost:3000', leagueId?: string) {
    this.baseUrl = baseUrl;
    this.testLeagueId = leagueId || process.env.TEST_LEAGUE_ID || '';

    if (!this.testLeagueId) {
      throw new Error('TEST_LEAGUE_ID environment variable or parameter required');
    }
  }

  async makeRequest(endpoint: string, options: RequestInit = {}): Promise<{
    success: boolean;
    duration: number;
    error?: string;
    response?: any;
  }> {
    const start = performance.now();

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        timeout: 30000, // 30 second timeout
        ...options,
      });

      const duration = performance.now() - start;
      const data = await response.json();

      return {
        success: response.ok && data.ok !== false,
        duration,
        response: data,
        error: !response.ok ? `HTTP ${response.status}: ${data.error}` : undefined
      };
    } catch (error) {
      const duration = performance.now() - start;
      return {
        success: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async testConcurrentSyncs(concurrency: number): Promise<LoadTestResult> {
    console.log(`🔄 Testing ${concurrency} concurrent sync requests...`);

    const promises = Array.from({ length: concurrency }, (_, i) =>
      this.makeRequest('/api/sync/league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: this.testLeagueId,
          background: true,
          incremental: true
        })
      })
    );

    const results = await Promise.all(promises);

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const durations = results.map(r => r.duration);
    const errors = results.filter(r => r.error).map(r => r.error!);

    return {
      concurrent: concurrency,
      successful,
      failed,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      errors: [...new Set(errors)] // Unique errors
    };
  }

  async testSyncStatusRaceCondition(): Promise<void> {
    console.log('\n🏃‍♂️ Testing sync status race conditions...');

    // Start multiple syncs simultaneously
    const syncPromises = Array.from({ length: 5 }, () =>
      this.makeRequest('/api/sync/league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: this.testLeagueId,
          incremental: true
        })
      })
    );

    const results = await Promise.all(syncPromises);

    // Check how many actually executed vs were rejected
    const executed = results.filter(r => r.success).length;
    const rejected = results.filter(r =>
      !r.success && r.error?.includes('already syncing')
    ).length;

    console.log(`✅ Race condition test: ${executed} executed, ${rejected} properly rejected`);

    if (executed > 1) {
      console.log('⚠️  Warning: Multiple syncs executed simultaneously - potential race condition');
    }
  }

  async testStalenessCheckLoad(): Promise<void> {
    console.log('\n📊 Testing staleness check endpoint load...');

    const concurrency = 20;
    const promises = Array.from({ length: concurrency }, () =>
      this.makeRequest(`/api/sync/check-staleness?leagueId=${this.testLeagueId}`)
    );

    const start = performance.now();
    const results = await Promise.all(promises);
    const totalDuration = performance.now() - start;

    const successful = results.filter(r => r.success).length;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    console.log(`✅ Staleness check load test: ${successful}/${concurrency} successful`);
    console.log(`📈 Average response time: ${avgDuration.toFixed(2)}ms`);
    console.log(`⏱️  Total test duration: ${totalDuration.toFixed(2)}ms`);
  }

  async testProgressiveConcurrency(): Promise<void> {
    console.log('\n📈 Testing progressive concurrency...');

    const concurrencyLevels = [1, 2, 5, 10, 15, 20];
    const results: LoadTestResult[] = [];

    for (const concurrency of concurrencyLevels) {
      const result = await this.testConcurrentSyncs(concurrency);
      results.push(result);

      console.log(`${concurrency} concurrent: ${result.successful}/${result.concurrent} successful, avg ${result.avgDuration.toFixed(2)}ms`);

      // Wait between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Print summary table
    console.log('\n📊 Concurrency Summary:');
    console.log('Level | Success Rate | Avg Duration | Max Duration | Errors');
    console.log('------|--------------|--------------|--------------|--------');

    results.forEach(r => {
      const successRate = ((r.successful / r.concurrent) * 100).toFixed(1);
      const errorCount = r.errors.length;
      console.log(
        `${r.concurrent.toString().padStart(5)} | ${successRate.padStart(10)}% | ${r.avgDuration.toFixed(2).padStart(10)}ms | ${r.maxDuration.toFixed(2).padStart(10)}ms | ${errorCount}`
      );
    });
  }

  async testErrorRecovery(): Promise<void> {
    console.log('\n🔧 Testing error recovery...');

    // Test with invalid league ID
    const invalidResult = await this.makeRequest('/api/sync/league', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'invalid_league_id',
        incremental: true
      })
    });

    console.log(`❌ Invalid league ID: ${invalidResult.success ? 'Unexpectedly succeeded' : 'Properly rejected'}`);
    if (invalidResult.error) {
      console.log(`   Error: ${invalidResult.error}`);
    }

    // Test missing parameters
    const missingParamResult = await this.makeRequest('/api/sync/league', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    console.log(`📝 Missing parameters: ${missingParamResult.success ? 'Unexpectedly succeeded' : 'Properly rejected'}`);
    if (missingParamResult.error) {
      console.log(`   Error: ${missingParamResult.error}`);
    }
  }

  async runLoadTests(): Promise<void> {
    console.log(`🚀 Starting Load Tests for League: ${this.testLeagueId}`);
    console.log(`🌐 Base URL: ${this.baseUrl}\n`);

    try {
      await this.testStalenessCheckLoad();
      await this.testSyncStatusRaceCondition();
      await this.testProgressiveConcurrency();
      await this.testErrorRecovery();

      console.log('\n✅ Load testing completed successfully!');
    } catch (error) {
      console.error('\n❌ Load testing failed:', error);
      throw error;
    }
  }
}

// Helper function to test middleware behavior
async function testMiddlewareLoad() {
  console.log('\n🛡️ Testing Middleware Load...');

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const leagueId = process.env.TEST_LEAGUE_ID;

  if (!leagueId) {
    console.log('⚠️  Skipping middleware test - TEST_LEAGUE_ID not set');
    return;
  }

  const routes = [
    `/roster?leagueId=${leagueId}&rosterId=1`,
    `/player-scoring?leagueId=${leagueId}&playerId=4046&playerName=Josh%20Allen`
  ];

  for (const route of routes) {
    console.log(`📄 Testing route: ${route}`);

    const promises = Array.from({ length: 10 }, () =>
      fetch(`${baseUrl}${route}`, { method: 'HEAD' })
    );

    const start = performance.now();
    const responses = await Promise.all(promises);
    const duration = performance.now() - start;

    const successful = responses.filter(r => r.ok).length;
    console.log(`   ${successful}/10 requests successful in ${duration.toFixed(2)}ms`);
  }
}

// Main execution
async function main() {
  const command = process.argv[2];
  const leagueId = process.argv[3];

  if (!leagueId && !process.env.TEST_LEAGUE_ID) {
    console.error('Usage: tsx scripts/load-test-sync.ts [LEAGUE_ID]');
    console.error('Or set TEST_LEAGUE_ID environment variable');
    process.exit(1);
  }

  try {
    if (command === 'middleware') {
      await testMiddlewareLoad();
    } else {
      const tester = new SyncLoadTester(undefined, leagueId);
      await tester.runLoadTests();
    }
  } catch (error) {
    console.error('Load test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}