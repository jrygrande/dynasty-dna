// Render-layer anonymization for the demo league. Maps real Sleeper user_ids
// and roster_ids onto curated NFL-coach + football-team pseudonyms, deriving
// stable in-session mappings from a per-session seed.
//
// All functions are pure: they take real names + a seed and return a mapping.
// No React, no fetching, no side effects — see useDemoMap() for the hook.

export const COACHES_ELITE = [
  "Bill Belichick",
  "Vince Lombardi",
  "Bill Walsh",
  "Chuck Noll",
  "Andy Reid",
  "Tom Landry",
  "Don Shula",
  "Bill Parcells",
  "Sean McVay",
  "Mike Tomlin",
  "Joe Gibbs",
  "Tony Dungy",
] as const;

export const COACHES_MID = [
  "Mike McDaniel",
  "Sean Payton",
  "Pete Carroll",
  "Jon Gruden",
  "Rex Ryan",
  "Bruce Arians",
  "Mike Ditka",
  "Marv Levy",
  "Dennis Green",
  "Jim Mora",
  "Buddy Ryan",
  "Brian Billick",
] as const;

export const COACHES_FLAMEOUT = [
  "Urban Meyer",
  "Nathaniel Hackett",
  "Hue Jackson",
  "Adam Gase",
  "Matt Patricia",
  "Joe Judge",
  "Josh McDaniels",
  "Lovie Smith",
  "Rich Kotite",
  "Cam Cameron",
  "Bobby Petrino",
  "Steve Spurrier",
] as const;

// Used by the whole-league fallback when any manager is missing metrics.
// Order doesn't matter — the shuffle randomizes it per session.
export const COACHES_FALLBACK_POOL = [
  ...COACHES_ELITE,
  ...COACHES_MID,
  ...COACHES_FLAMEOUT,
];

export const TEAM_NAMES = [
  "Dillon Panthers",
  "Miami Sharks",
  "Washington Sentinels",
  "Mean Machine",
  "Texas State Armadillos",
  "SCLSU Mud Dogs",
  "West Canaan Coyotes",
  "T.C. Williams Titans",
  "ESU Timberwolves",
  "Central High Wildcats",
  "Ampipe Bulldogs",
  "Minnesota State Screaming Eagles",
] as const;

// Tail for leagues with > 12 rosters
export const TEAM_NAMES_TAIL = [
  "Steel Curtain",
  "Legion of Boom",
  "Greatest Show on Turf",
  "Purple People Eaters",
  "Doomsday Defense",
  "No-Name Defense",
  "Fearsome Foursome",
  "K-Gun",
  "Air Coryell",
  "Monsters of the Midway",
  "The Hogs",
  "46 Defense",
] as const;

// mulberry32: tiny seeded PRNG. Returns a function that yields uniform
// floats in [0, 1) for a given 32-bit unsigned integer seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convert a base36 seed string (or anything else) into a 32-bit unsigned int.
// Uses a simple FNV-1a-style fold so different strings produce different ints.
export function seedToInt(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Fisher-Yates, seeded by the supplied PRNG.
export function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Initials for the avatar fallback chip. "Bill Belichick" -> "BB".
export function initialsFromName(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "??";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[1][0]).toUpperCase();
}

export interface ManagerInput {
  userId: string;
  // overall_score / all_time. null = missing for this manager.
  score: number | null;
}

export interface RosterInput {
  rosterId: number;
  ownerId: string | null;
}

export interface DemoUserMapping {
  displayName: string;
  teamName: string;
  initials: string;
}

export interface DemoMap {
  users: Map<string, DemoUserMapping>;
  rosters: Map<number, { teamName: string }>;
  // Direct roster -> manager swap, for UI surfaces that only have rosterId.
  byRoster: Map<number, DemoUserMapping>;
}

// Resolve the demo swap for a manager. Most call sites have either userId or
// rosterId (some have both); a single helper keeps the precedence consistent.
export function lookupSwap(
  map: DemoMap,
  userId?: string | null,
  rosterId?: number | null
): DemoUserMapping | undefined {
  if (userId) {
    const byUser = map.users.get(userId);
    if (byUser) return byUser;
  }
  if (rosterId != null) return map.byRoster.get(rosterId);
  return undefined;
}

// Sort managers by score DESC, tiebreaker manager_id ASC. Stable + deterministic.
function sortByScoreDesc(managers: ManagerInput[]): ManagerInput[] {
  return managers.slice().sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sb !== sa) return sb - sa;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}

// Floor-ends rule: tier_size = floor(N/3) for elite + flame-out, middle catches
// the remainder. For 12 -> [4,4,4], 11 -> [3,5,3], 10 -> [3,4,3], 9 -> [3,3,3].
export function tierSplit(n: number): [number, number, number] {
  const ends = Math.floor(n / 3);
  const middle = n - 2 * ends;
  return [ends, middle, ends];
}

// Build the team-name pool for a given roster count, padding with the tail
// nicknames if the league has more than 12 rosters.
function buildTeamPool(rosterCount: number): string[] {
  if (rosterCount <= TEAM_NAMES.length) {
    return TEAM_NAMES.slice();
  }
  const overflow = rosterCount - TEAM_NAMES.length;
  return [...TEAM_NAMES, ...TEAM_NAMES_TAIL.slice(0, overflow)];
}

// Pick a coach pseudonym for each manager. Uses tier mapping when every manager
// has a non-null score; otherwise falls back to a deterministic-by-user_id-hash
// assignment from the flat 36-coach pool.
function assignCoaches(
  managers: ManagerInput[],
  rand: () => number
): Map<string, string> {
  const out = new Map<string, string>();
  const anyMissing = managers.some((m) => m.score === null);

  if (anyMissing) {
    // Whole-league fallback: shuffle the flat pool with the seeded PRNG, then
    // assign in user_id ASC order so the result is stable for a given seed
    // even when scores aren't usable.
    const sorted = managers
      .slice()
      .sort((a, b) =>
        a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
      );
    const pool = shuffle(COACHES_FALLBACK_POOL, rand);
    sorted.forEach((m, i) => {
      out.set(m.userId, pool[i % pool.length]);
    });
    return out;
  }

  const sorted = sortByScoreDesc(managers);
  const [eliteSize, midSize] = tierSplit(sorted.length);
  const elitePool = shuffle(COACHES_ELITE, rand);
  const midPool = shuffle(COACHES_MID, rand);
  const flamePool = shuffle(COACHES_FLAMEOUT, rand);

  sorted.forEach((m, i) => {
    let name: string;
    if (i < eliteSize) {
      name = elitePool[i % elitePool.length];
    } else if (i < eliteSize + midSize) {
      name = midPool[(i - eliteSize) % midPool.length];
    } else {
      name = flamePool[(i - eliteSize - midSize) % flamePool.length];
    }
    out.set(m.userId, name);
  });
  return out;
}

// Build the per-session demo mapping. Given the real managers + rosters and a
// seed string, returns a stable Map keyed by user_id and roster_id.
export function buildDemoMap(
  managers: ManagerInput[],
  rosters: RosterInput[],
  seed: string
): DemoMap {
  const rand = mulberry32(seedToInt(seed));

  // Coach assignments first. This consumes a deterministic chunk of PRNG output
  // (one shuffle per tier or one shuffle in the fallback path).
  const coachByUser = assignCoaches(managers, rand);

  // Then team assignments. Order rosters by roster_id ASC and map onto the
  // shuffled team pool so the same roster always gets the same team for the
  // duration of a session.
  const sortedRosters = rosters.slice().sort((a, b) => a.rosterId - b.rosterId);
  const teamPool = shuffle(buildTeamPool(sortedRosters.length), rand);
  const teamByRoster = new Map<number, string>();
  sortedRosters.forEach((r, i) => {
    teamByRoster.set(r.rosterId, teamPool[i % teamPool.length]);
  });

  const users = new Map<string, DemoUserMapping>();
  for (const [userId, displayName] of coachByUser) {
    // A user's team name is the team assigned to their owned roster, if any.
    // If they don't own a roster (rare), fall back to the first team from the
    // pool so the mapping still has *something* to render.
    const owned = sortedRosters.find((r) => r.ownerId === userId);
    const teamName =
      (owned && teamByRoster.get(owned.rosterId)) || teamPool[0] || "Team";
    users.set(userId, {
      displayName,
      teamName,
      initials: initialsFromName(displayName),
    });
  }

  const rostersOut = new Map<number, { teamName: string }>();
  const byRoster = new Map<number, DemoUserMapping>();
  for (const [rosterId, teamName] of teamByRoster) {
    rostersOut.set(rosterId, { teamName });
    const owner = sortedRosters.find((r) => r.rosterId === rosterId)?.ownerId;
    if (owner) {
      const swap = users.get(owner);
      if (swap) byRoster.set(rosterId, swap);
    }
  }

  return { users, rosters: rostersOut, byRoster };
}

// Generate a fresh per-session seed. Uses crypto.getRandomValues when
// available (browser + modern Node) and falls back to Math.random as a
// best-effort path on older runtimes.
export function generateSeed(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0].toString(36);
  }
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}
