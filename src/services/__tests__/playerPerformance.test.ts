import { calculateMetrics, extractOwnershipPeriods } from '../playerPerformance';
import type { PlayerScore, PerformanceMetrics } from '@/types/playerPerformance';
import type { TimelineEvent } from '@/lib/api/assets';

describe('calculateMetrics', () => {
  test('calculates PPG from scores', () => {
    const scores: PlayerScore[] = [
      { leagueId: '123', week: 1, rosterId: 1, playerId: '4866', points: '10.0', isStarter: true },
      { leagueId: '123', week: 2, rosterId: 1, playerId: '4866', points: '20.0', isStarter: true },
      { leagueId: '123', week: 3, rosterId: 1, playerId: '4866', points: '15.0', isStarter: true }
    ];

    const metrics = calculateMetrics(scores);
    expect(metrics.ppg).toBe(15);
    expect(metrics.gamesPlayed).toBe(3);
    expect(metrics.gamesStarted).toBe(3);
  });

  test('calculates starter percentage', () => {
    const scores: PlayerScore[] = [
      { leagueId: '123', week: 1, rosterId: 1, playerId: '4866', points: '10.0', isStarter: true },
      { leagueId: '123', week: 2, rosterId: 1, playerId: '4866', points: '5.0', isStarter: false },
      { leagueId: '123', week: 3, rosterId: 1, playerId: '4866', points: '15.0', isStarter: true }
    ];

    const metrics = calculateMetrics(scores);
    expect(metrics.starterPct).toBeCloseTo(66.67, 1);
    expect(metrics.gamesStarted).toBe(2);
    expect(metrics.gamesPlayed).toBe(3);
  });

  test('calculates separate PPG for starters and bench', () => {
    const scores: PlayerScore[] = [
      { leagueId: '123', week: 1, rosterId: 1, playerId: '4866', points: '20.0', isStarter: true },
      { leagueId: '123', week: 2, rosterId: 1, playerId: '4866', points: '10.0', isStarter: true },
      { leagueId: '123', week: 3, rosterId: 1, playerId: '4866', points: '5.0', isStarter: false },
      { leagueId: '123', week: 4, rosterId: 1, playerId: '4866', points: '3.0', isStarter: false }
    ];

    const metrics = calculateMetrics(scores);
    expect(metrics.ppgStarter).toBe(15); // (20+10)/2
    expect(metrics.ppgBench).toBe(4);    // (5+3)/2
    expect(metrics.ppg).toBe(9.5);       // (20+10+5+3)/4
  });

  test('handles no games gracefully', () => {
    const metrics = calculateMetrics([]);
    expect(metrics.ppg).toBe(0);
    expect(metrics.starterPct).toBe(0);
    expect(metrics.ppgStarter).toBe(0);
    expect(metrics.ppgBench).toBe(0);
    expect(metrics.gamesPlayed).toBe(0);
    expect(metrics.gamesStarted).toBe(0);
  });

  test('handles only starter games', () => {
    const scores: PlayerScore[] = [
      { leagueId: '123', week: 1, rosterId: 1, playerId: '4866', points: '20.0', isStarter: true },
      { leagueId: '123', week: 2, rosterId: 1, playerId: '4866', points: '15.0', isStarter: true }
    ];

    const metrics = calculateMetrics(scores);
    expect(metrics.starterPct).toBe(100);
    expect(metrics.ppgStarter).toBe(17.5);
    expect(metrics.ppgBench).toBe(0);
  });

  test('handles only bench games', () => {
    const scores: PlayerScore[] = [
      { leagueId: '123', week: 1, rosterId: 1, playerId: '4866', points: '5.0', isStarter: false },
      { leagueId: '123', week: 2, rosterId: 1, playerId: '4866', points: '3.0', isStarter: false }
    ];

    const metrics = calculateMetrics(scores);
    expect(metrics.starterPct).toBe(0);
    expect(metrics.ppgStarter).toBe(0);
    expect(metrics.ppgBench).toBe(4);
    expect(metrics.gamesStarted).toBe(0);
  });
});

describe('extractOwnershipPeriods', () => {
  test('creates performance periods from timeline events', () => {
    const events: TimelineEvent[] = [
      {
        id: '1',
        leagueId: '123',
        season: '2021',
        week: 0,
        eventTime: null,
        eventType: 'draft_selected',
        fromRosterId: null,
        toRosterId: 1,
        fromUser: null,
        toUser: { id: 'user1', username: 'user1', displayName: 'User 1' },
        details: null,
        transactionId: null
      },
      {
        id: '2',
        leagueId: '123',
        season: '2021',
        week: 8,
        eventTime: null,
        eventType: 'trade',
        fromRosterId: 1,
        toRosterId: 2,
        fromUser: { id: 'user1', username: 'user1', displayName: 'User 1' },
        toUser: { id: 'user2', username: 'user2', displayName: 'User 2' },
        details: null,
        transactionId: 'tx1'
      },
      {
        id: '3',
        leagueId: '456',
        season: '2022',
        week: 3,
        eventTime: null,
        eventType: 'trade',
        fromRosterId: 2,
        toRosterId: 3,
        fromUser: { id: 'user2', username: 'user2', displayName: 'User 2' },
        toUser: { id: 'user3', username: 'user3', displayName: 'User 3' },
        details: null,
        transactionId: 'tx2'
      }
    ];

    const periods = extractOwnershipPeriods(events);

    expect(periods).toHaveLength(3);

    // First period: drafted, played weeks 1-8
    expect(periods[0]).toEqual({
      fromEventId: '1',
      toEventId: '2',
      leagueId: '123',
      season: '2021',
      rosterId: 1,
      ownerUserId: 'user1',
      startWeek: 1,
      endWeek: 8
    });

    // Second period: traded, played weeks 9-end of season
    expect(periods[1]).toEqual({
      fromEventId: '2',
      toEventId: '3',
      leagueId: '123',
      season: '2021',
      rosterId: 2,
      ownerUserId: 'user2',
      startWeek: 9,
      endWeek: null // Goes to next event which is different season
    });

    // Third period: new season, played from week 4 onwards
    expect(periods[2]).toEqual({
      fromEventId: '3',
      toEventId: null,
      leagueId: '456',
      season: '2022',
      rosterId: 3,
      ownerUserId: 'user3',
      startWeek: 4,
      endWeek: null
    });
  });

  test('handles draft at week 0 correctly', () => {
    const events: TimelineEvent[] = [
      {
        id: '1',
        leagueId: '123',
        season: '2021',
        week: 0,
        eventTime: null,
        eventType: 'draft_selected',
        fromRosterId: null,
        toRosterId: 1,
        fromUser: null,
        toUser: { id: 'user1', username: 'user1', displayName: 'User 1' },
        details: null,
        transactionId: null
      }
    ];

    const periods = extractOwnershipPeriods(events);

    expect(periods).toHaveLength(1);
    expect(periods[0].startWeek).toBe(1); // Week 0 -> Week 1
    expect(periods[0].endWeek).toBe(null); // No next event
  });

  test('handles same week transactions', () => {
    const events: TimelineEvent[] = [
      {
        id: '1',
        leagueId: '123',
        season: '2021',
        week: 5,
        eventTime: null,
        eventType: 'trade',
        fromRosterId: 1,
        toRosterId: 2,
        fromUser: { id: 'user1', username: 'user1', displayName: 'User 1' },
        toUser: { id: 'user2', username: 'user2', displayName: 'User 2' },
        details: null,
        transactionId: 'tx1'
      },
      {
        id: '2',
        leagueId: '123',
        season: '2021',
        week: 5,
        eventTime: null,
        eventType: 'trade',
        fromRosterId: 2,
        toRosterId: 3,
        fromUser: { id: 'user2', username: 'user2', displayName: 'User 2' },
        toUser: { id: 'user3', username: 'user3', displayName: 'User 3' },
        details: null,
        transactionId: 'tx2'
      }
    ];

    const periods = extractOwnershipPeriods(events);

    expect(periods).toHaveLength(2);
    expect(periods[0].startWeek).toBe(6); // After week 5 trade
    expect(periods[0].endWeek).toBe(5);   // Same week as next trade
    expect(periods[1].startWeek).toBe(6); // After week 5 trade
  });
});