import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

// ============================================================
// Algorithm Configuration Type
// ============================================================

export interface BlendBreakpoint {
  weeks: number;
  weight: number;
}

export interface AlgorithmConfig {
  // Quality x quantity blend weights (α per pillar)
  qualityWeights: {
    trade_score: number;
    draft_score: number;
    waiver_score: number;
  };

  // Blend profiles (production weight ramp curves)
  blendProfiles: {
    trade: BlendBreakpoint[];
    draft: BlendBreakpoint[];
    waiver: BlendBreakpoint[];
  };

  // Grade thresholds and scaling
  gradeThresholds: Record<string, number>;
  valueScaling: number;
  productionScaling: number;

  // Replacement ranks
  replacementRank: Record<string, number>;
  replacementRankSF: Record<string, number>;

  // Draft grading config
  draftConfig: {
    benchmarkWindow: number;
    benchmarkTake: number;
    minBenchmark: number;
    valueScalingMax: number;
    valueScalingMin: number;
    productionScalingMax: number;
    productionScalingMin: number;
    bonusStartPercentile: number;
    bonusProductionThreshold: number;
    bonusMaxPoints: number;
    bonusExcessCap: number;
  };

  // Waiver grading config
  waiverValueScaling: number;
  faabBonusMax: number;

  // Trade grading config
  defaultRoundAverages: Record<number, number>;

  // Overall score pillar weights
  pillarWeights: {
    trade_score: number;
    draft_score: number;
    waiver_score: number;
    lineup_score: number;
  };

  // Lineup grading config
  lineupSlotScores: {
    followedGood: number;
    followedBad: number;
    brokeGood: number;
    brokeBad: number;
  };
  lineupRollingWindow: number;
}

// ============================================================
// Default Configuration (byte-identical to current hardcoded values)
// ============================================================

export const DEFAULT_CONFIG: AlgorithmConfig = {
  qualityWeights: {
    trade_score: 0.50,
    draft_score: 0.60,
    waiver_score: 0.40,
  },

  blendProfiles: {
    trade: [
      { weeks: 0, weight: 0 },
      { weeks: 2, weight: 0 },
      { weeks: 8, weight: 0.3 },
      { weeks: 52, weight: 0.7 },
      { weeks: 156, weight: 0.85 },
      { weeks: 260, weight: 0.95 },
    ],
    draft: [
      { weeks: 0, weight: 0 },
      { weeks: 8, weight: 0 },
      { weeks: 52, weight: 0.5 },
      { weeks: 156, weight: 0.85 },
      { weeks: 260, weight: 0.95 },
    ],
    waiver: [
      { weeks: 0, weight: 0.2 },
      { weeks: 2, weight: 0.2 },
      { weeks: 8, weight: 0.6 },
      { weeks: 52, weight: 0.9 },
      { weeks: 260, weight: 0.95 },
    ],
  },

  gradeThresholds: {
    "A+": 72,
    A: 64,
    "B+": 58,
    B: 54,
    C: 44,
    D: 40,
    "D-": 34,
  },
  valueScaling: 10000,
  productionScaling: 300,

  replacementRank: { QB: 12, RB: 24, WR: 36, TE: 12 },
  replacementRankSF: { QB: 24, RB: 24, WR: 36, TE: 12 },

  draftConfig: {
    benchmarkWindow: 8,
    benchmarkTake: 6,
    minBenchmark: 4,
    valueScalingMax: 10000,
    valueScalingMin: 1500,
    productionScalingMax: 300,
    productionScalingMin: 80,
    bonusStartPercentile: 0.4,
    bonusProductionThreshold: 40,
    bonusMaxPoints: 20,
    bonusExcessCap: 200,
  },

  waiverValueScaling: 3000,
  faabBonusMax: 10,

  defaultRoundAverages: { 1: 6000, 2: 2500, 3: 1000, 4: 250 },

  pillarWeights: {
    trade_score: 1.0,
    draft_score: 1.0,
    waiver_score: 1.0,
    lineup_score: 1.0,
  },

  lineupSlotScores: {
    followedGood: 1.0,
    followedBad: 0.3,
    brokeGood: 2.0,
    brokeBad: -0.5,
  },
  lineupRollingWindow: 4,
};

// ============================================================
// Config Loading (with cache)
// ============================================================

let cachedConfig: AlgorithmConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

function deepMerge(defaults: AlgorithmConfig, overrides: Partial<AlgorithmConfig>): AlgorithmConfig {
  const result = { ...defaults };
  for (const key of Object.keys(overrides) as (keyof AlgorithmConfig)[]) {
    const val = overrides[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "object" && !Array.isArray(val) && typeof defaults[key] === "object" && !Array.isArray(defaults[key])) {
      (result as Record<string, unknown>)[key] = { ...(defaults[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
    } else {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

/**
 * Load the active algorithm config. Returns DEFAULT_CONFIG if no DB row exists.
 * Caches for 60 seconds to avoid repeated DB hits within a grading run.
 */
export async function getActiveConfig(): Promise<AlgorithmConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const db = getDb();
    const [row] = await db
      .select({ config: schema.algorithmConfig.config })
      .from(schema.algorithmConfig)
      .where(eq(schema.algorithmConfig.isActive, true))
      .limit(1);

    if (row?.config && typeof row.config === "object") {
      cachedConfig = deepMerge(DEFAULT_CONFIG, row.config as Partial<AlgorithmConfig>);
    } else {
      cachedConfig = DEFAULT_CONFIG;
    }
  } catch {
    cachedConfig = DEFAULT_CONFIG;
  }

  cacheTimestamp = Date.now();
  return cachedConfig;
}

/** Clear the config cache (useful in tests or after promoting a new config) */
export function clearConfigCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}

// ============================================================
// Config Promotion
// ============================================================

/**
 * Promote a new config version. Deactivates all existing configs and
 * inserts the new one as active.
 */
export async function promoteConfig(opts: {
  config: Partial<AlgorithmConfig>;
  experimentId?: string;
  promotedBy?: string;
  notes?: string;
}): Promise<string> {
  const db = getDb();

  const [row] = await db.transaction(async (tx) => {
    // Deactivate all existing configs
    await tx
      .update(schema.algorithmConfig)
      .set({ isActive: false })
      .where(eq(schema.algorithmConfig.isActive, true));

    // Insert new active config
    return tx
      .insert(schema.algorithmConfig)
      .values({
        config: opts.config,
        experimentId: opts.experimentId ?? null,
        isActive: true,
        promotedBy: opts.promotedBy ?? null,
        notes: opts.notes ?? null,
      })
      .returning({ id: schema.algorithmConfig.id });
  });

  clearConfigCache();
  return row.id;
}
