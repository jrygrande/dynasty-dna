import { sleeperClient } from '../../src/services/sleeperClient';

describe('SleeperClient Unit Tests', () => {
  beforeAll(() => {
    // Clear cache before testing
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
      const statsBefore = sleeperClient.getCacheStats();
      
      await sleeperClient.getNFLState();
      await sleeperClient.getNFLState(); // Second call should hit cache
      
      const statsAfter = sleeperClient.getCacheStats();
      expect(statsAfter.hits).toBeGreaterThan(statsBefore.hits);
    });
  });

  describe('getUser', () => {
    it('should return user data for valid username', async () => {
      const username = 'jrygrande';
      const user = await sleeperClient.getUser(username);
      
      expect(user).toHaveProperty('user_id');
      expect(user).toHaveProperty('username');
      expect(user.username).toBe(username);
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
      
      expect(league).toHaveProperty('name');
      expect(league).toHaveProperty('season');
      expect(league).toHaveProperty('total_rosters');
      expect(league.name).toBe('Dynasty Domination');
    });

    it('should return null for invalid league ID', async () => {
      const league = await sleeperClient.getLeague('invalid_league_id');
      expect(league).toBeNull();
    });
  });

  describe('Cache Management', () => {
    it('should track cache statistics correctly', async () => {
      sleeperClient.clearCache();
      const initialStats = sleeperClient.getCacheStats();
      
      expect(initialStats.hits).toBe(0);
      expect(initialStats.misses).toBe(0);
      
      // Make some API calls
      await sleeperClient.getNFLState();
      await sleeperClient.getNFLState(); // Should hit cache
      
      const finalStats = sleeperClient.getCacheStats();
      expect(finalStats.misses).toBe(1);
      expect(finalStats.hits).toBe(1);
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