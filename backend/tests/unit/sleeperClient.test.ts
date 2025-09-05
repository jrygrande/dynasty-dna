import { sleeperClient } from '../../src/services/sleeperClient';

describe('SleeperClient Unit Tests', () => {
  beforeAll(() => {
    // Clear cache before testing
    sleeperClient.clearCache();
  });

  beforeEach(() => {
    // Clear cache before each test for isolation
    sleeperClient.clearCache();
  });

  describe('getNFLState', () => {
    it('should return current NFL state', async () => {
      const nflState = await sleeperClient.getNFLState();
      
      expect(nflState).toHaveProperty('season');
      expect(nflState).toHaveProperty('week');
      expect(nflState).toHaveProperty('season_type');
      expect(typeof nflState.season).toBe('string');
      expect(typeof nflState.week).toBe('number');
    });

    it('should cache NFL state on subsequent calls', async () => {
      // Make first call
      const firstCall = await sleeperClient.getNFLState();
      
      // Make second call - should be faster due to caching
      const startTime = Date.now();
      const secondCall = await sleeperClient.getNFLState();
      const duration = Date.now() - startTime;
      
      // Results should be identical and second call should be fast (< 10ms due to caching)
      expect(firstCall).toEqual(secondCall);
      expect(duration).toBeLessThan(10);
    });
  });

  describe('getUser', () => {
    it('should return user data for valid username', async () => {
      const username = 'jrygrande';
      const user = await sleeperClient.getUser(username);
      
      expect(user).not.toBeNull();
      expect(user).toHaveProperty('user_id');
      expect(user).toHaveProperty('username');
      expect(user!.username).toBe(username);
    });

    it('should return null for invalid username', async () => {
      const user = await sleeperClient.getUser('invalid_user_that_does_not_exist_12345');
      expect(user).toBeNull();
    });
  });

  describe('getLeague', () => {
    it('should return league data for valid league ID', async () => {
      const leagueId = '1191596293294166016';
      const league = await sleeperClient.getLeague(leagueId);
      
      expect(league).not.toBeNull();
      expect(league).toHaveProperty('name');
      expect(league).toHaveProperty('season');
      expect(league).toHaveProperty('total_rosters');
      expect(league!.name).toBe('Dynasty Domination');
    });

    it('should return null for invalid league ID', async () => {
      const league = await sleeperClient.getLeague('invalid_league_id');
      expect(league).toBeNull();
    });
  });

  describe('Cache Management', () => {
    it('should track cache statistics correctly', async () => {
      // Make first API call - populate cache
      await sleeperClient.getNFLState();
      const statsAfterPopulation = sleeperClient.getCacheStats();
      
      // Cache should have at least one key after population
      expect(statsAfterPopulation.keys).toBeGreaterThanOrEqual(1);
      
      // Make second API call - should use cache and be fast
      const startTime = Date.now();
      await sleeperClient.getNFLState();
      const cachedCallDuration = Date.now() - startTime;
      
      // Cached calls should be very fast
      expect(cachedCallDuration).toBeLessThan(10);
    });

    it('should clear cache when requested', async () => {
      // Add some data to cache
      await sleeperClient.getNFLState();
      expect(sleeperClient.getCacheStats().keys).toBeGreaterThan(0);
      
      // Clear cache
      sleeperClient.clearCache();
      expect(sleeperClient.getCacheStats().keys).toBe(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should respect rate limits with delays between calls', async () => {
      const startTime = Date.now();
      
      // Make multiple calls that should trigger rate limiting
      await Promise.all([
        sleeperClient.getUser('jrygrande'),
        sleeperClient.getLeague('1191596293294166016')
      ]);
      
      const elapsed = Date.now() - startTime;
      // Should take at least some time due to rate limiting delays
      expect(elapsed).toBeGreaterThan(50);
    });
  });
});