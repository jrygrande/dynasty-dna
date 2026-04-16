/**
 * Tests for the feature-flag convention and isEnabled() behavior.
 *
 * We test isEnabled() directly (the pure logic) rather than the useFlag() hook
 * itself, since the hook just wraps isEnabled() with useSession() and testing
 * the hook would require @testing-library/react.
 *
 * These tests also lock in the convention that callers must pass the FLAGS
 * object KEY (e.g. "ASSET_GRAPH_BROWSER"), not the flag.id (e.g.
 * "asset-graph-browser"). Callers who pass the id form silently get `false`.
 */
import { FLAGS, isEnabled, type FeatureFlag } from "@/lib/featureFlags";

describe("feature-flag convention: isEnabled()", () => {
  const mutableFlags = FLAGS as unknown as Record<string, FeatureFlag>;
  const TEST_ENABLED_KEY = "__TEST_ENABLED__";
  const TEST_EXPERIMENT_KEY = "__TEST_EXPERIMENT__";

  beforeAll(() => {
    mutableFlags[TEST_ENABLED_KEY] = {
      id: "test-enabled",
      title: "Test: always-on flag",
      description: "Used only in tests; status is 'enabled'",
      status: "enabled",
    };
    mutableFlags[TEST_EXPERIMENT_KEY] = {
      id: "test-experiment",
      title: "Test: 50% experiment flag",
      description: "Used only in tests; deterministic bucketing at 50%",
      status: "experiment",
      rolloutPercent: 50,
    };
  });

  afterAll(() => {
    delete mutableFlags[TEST_ENABLED_KEY];
    delete mutableFlags[TEST_EXPERIMENT_KEY];
  });

  it("returns false for ASSET_GRAPH_BROWSER (currently disabled)", () => {
    expect(isEnabled("ASSET_GRAPH_BROWSER")).toBe(false);
    expect(isEnabled("ASSET_GRAPH_BROWSER", "any-user-id")).toBe(false);
  });

  it("returns true for an 'enabled' flag regardless of userId", () => {
    expect(isEnabled(TEST_ENABLED_KEY)).toBe(true);
    expect(isEnabled(TEST_ENABLED_KEY, "user-1")).toBe(true);
    expect(isEnabled(TEST_ENABLED_KEY, "user-2")).toBe(true);
  });

  it("bucket is deterministic for an 'experiment' flag with the same userId", () => {
    const userId = "deterministic-user-abc";
    const first = isEnabled(TEST_EXPERIMENT_KEY, userId);
    const second = isEnabled(TEST_EXPERIMENT_KEY, userId);
    const third = isEnabled(TEST_EXPERIMENT_KEY, userId);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("different users can land in different buckets for the same experiment", () => {
    // Collect bucket results across many users — at ~50% rollout we expect both
    // outcomes to appear. This guards against a regression that always returns
    // the same value regardless of userId.
    const results = new Set<boolean>();
    for (let i = 0; i < 50; i++) {
      results.add(isEnabled(TEST_EXPERIMENT_KEY, `user-${i}`));
    }
    expect(results.size).toBe(2);
  });

  it("convention: callers must use the FLAGS object KEY, not flag.id — using flag.id returns false", () => {
    // The object key is "ASSET_GRAPH_BROWSER"; the hyphenated id is "asset-graph-browser".
    // Looking up by the hyphenated id form silently misses and returns false.
    expect(isEnabled("asset-graph-browser")).toBe(false);
    expect(isEnabled("asset-graph-browser", "any-user-id")).toBe(false);
  });

  it("returns false for completely unknown keys", () => {
    expect(isEnabled("NOT_A_REAL_FLAG")).toBe(false);
  });
});
