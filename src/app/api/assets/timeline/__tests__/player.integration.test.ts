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
});