describe('Player Timeline API Integration', () => {
  test('returns performance data for Saquon Barkley', async () => {
    const response = await fetch('http://localhost:3005/api/assets/timeline/player?leagueId=1191596293294166016&playerId=4866');
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.performance).toBeDefined();
    expect(Array.isArray(data.performance)).toBe(true);

    if (data.performance.length > 0) {
      const firstPeriod = data.performance[0];

      // Verify structure
      expect(firstPeriod).toHaveProperty('fromEvent');
      expect(firstPeriod).toHaveProperty('toEvent');
      expect(firstPeriod).toHaveProperty('leagueId');
      expect(firstPeriod).toHaveProperty('season');
      expect(firstPeriod).toHaveProperty('rosterId');
      expect(firstPeriod).toHaveProperty('ownerUserId');
      expect(firstPeriod).toHaveProperty('startWeek');
      expect(firstPeriod).toHaveProperty('endWeek');
      expect(firstPeriod).toHaveProperty('metrics');

      // Verify metrics structure
      expect(firstPeriod.metrics).toHaveProperty('ppg');
      expect(firstPeriod.metrics).toHaveProperty('starterPct');
      expect(firstPeriod.metrics).toHaveProperty('ppgStarter');
      expect(firstPeriod.metrics).toHaveProperty('ppgBench');
      expect(firstPeriod.metrics).toHaveProperty('gamesPlayed');
      expect(firstPeriod.metrics).toHaveProperty('gamesStarted');

      // Verify metrics are reasonable
      expect(firstPeriod.metrics.ppg).toBeGreaterThanOrEqual(0);
      expect(firstPeriod.metrics.starterPct).toBeGreaterThanOrEqual(0);
      expect(firstPeriod.metrics.starterPct).toBeLessThanOrEqual(100);
      expect(firstPeriod.metrics.gamesPlayed).toBeGreaterThanOrEqual(0);
      expect(firstPeriod.metrics.gamesStarted).toBeLessThanOrEqual(firstPeriod.metrics.gamesPlayed);
    }
  });

  test('handles player with no performance data gracefully', async () => {
    // Test with a player who might not have scores
    const response = await fetch('http://localhost:3005/api/assets/timeline/player?leagueId=1191596293294166016&playerId=9999');
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.performance).toBeDefined();
    expect(Array.isArray(data.performance)).toBe(true);
  });

  test('validates API response time is reasonable', async () => {
    const startTime = Date.now();
    const response = await fetch('http://localhost:3005/api/assets/timeline/player?leagueId=1191596293294166016&playerId=4866');
    const endTime = Date.now();

    expect(response.ok).toBe(true);
    const responseTime = endTime - startTime;
    expect(responseTime).toBeLessThan(2000); // Should complete in under 2 seconds
  });

  test('includes performance data for all seasons player was active', async () => {
    const response = await fetch('http://localhost:3005/api/assets/timeline/player?leagueId=1191596293294166016&playerId=4866');
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.performance).toBeDefined();
    expect(Array.isArray(data.performance)).toBe(true);

    // Should have performance data for all seasons (2021-2025)
    const seasons = data.performance.map((p: any) => p.season).sort();
    expect(seasons).toEqual(['2021', '2021', '2022', '2023', '2024', '2025']);

    // Check continuation flags are correct
    const continuationPeriods = data.performance.filter((p: any) => p.isContinuation);
    expect(continuationPeriods.length).toBeGreaterThan(0); // Should have continuation periods

    // Verify continuation periods are for seasons after 2021
    for (const period of continuationPeriods) {
      expect(period.season).not.toBe('2021'); // 2021 had actual transactions
      expect(period.isContinuation).toBe(true);
    }

    // Verify metrics are reasonable for continuation periods
    for (const period of continuationPeriods) {
      expect(period.metrics.ppg).toBeGreaterThan(0);
      expect(period.metrics.gamesPlayed).toBeGreaterThan(0);
      expect(period.metrics.starterPct).toBeGreaterThanOrEqual(0);
      expect(period.metrics.starterPct).toBeLessThanOrEqual(100);
    }

    // Verify all seasons exclude week 18 (playoffs) and bye weeks - max 16 games
    for (const period of data.performance) {
      expect(period.metrics.gamesPlayed).toBeLessThanOrEqual(16); // Max 16 games (no week 18, no bye week)
      expect(period.metrics.gamesStarted).toBeLessThanOrEqual(period.metrics.gamesPlayed);
    }

    // Verify current season (2025) shows reasonable game counts for current week
    const currentSeasonPeriod = data.performance.find((p: any) => p.season === '2025');
    if (currentSeasonPeriod) {
      expect(currentSeasonPeriod.metrics.gamesPlayed).toBeLessThanOrEqual(3); // Should be around current week
    }
  });
});