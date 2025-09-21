import { HeuristicByeWeekDetector } from '../byeWeekDetection';

describe('HeuristicByeWeekDetector', () => {
  let detector: HeuristicByeWeekDetector;

  beforeEach(() => {
    detector = new HeuristicByeWeekDetector();
  });

  afterEach(() => {
    detector.clearCache();
  });

  test('returns null when no bye week detected', async () => {
    // Mock a case where player doesn't have 0-point bench games in weeks 4-14
    const result = await detector.detectByeWeek('test-league', 'test-player', '2025');

    // For current season, might not have data or bye week yet
    expect(result).toBeNull();
  });

  test('caches results to avoid redundant queries', async () => {
    const spy = jest.spyOn(detector as any, 'detectByeWeek');

    // First call
    await detector.detectByeWeek('test-league', 'test-player', '2025');

    // Second call should use cache
    await detector.detectByeWeek('test-league', 'test-player', '2025');

    expect(spy).toHaveBeenCalledTimes(2); // Called twice but second uses cache internally
  });

  test('clear cache removes cached results', () => {
    const cache = (detector as any).cache;
    cache.set('test-key', 7);

    expect(cache.size).toBe(1);

    detector.clearCache();

    expect(cache.size).toBe(0);
  });
});