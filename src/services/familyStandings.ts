import { getDb, schema } from "@/db";
import { inArray } from "drizzle-orm";
import type { SleeperBracketMatchup } from "@/lib/sleeper";
import { parsePlayoffResults } from "./outcomeScore";

export interface FamilyMemberRef {
  leagueId: string;
  season: string;
}

export interface AllTimeStanding {
  ownerId: string;
  // Most recent rosterId for the owner — used so demo-mode swaps can resolve
  // by roster.
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  seasonsPlayed: number;
  championshipYears: string[];
}

export function getChampionRosterFromBracket(
  bracket: SleeperBracketMatchup[] | null,
  numPlayoffTeams: number,
): number | null {
  if (!bracket || bracket.length === 0) return null;
  const results = parsePlayoffResults(bracket, numPlayoffTeams);
  return results.find((r) => r.placement === 1)?.rosterId ?? null;
}

export async function getAllTimeStandings(
  members: FamilyMemberRef[],
): Promise<AllTimeStanding[]> {
  if (members.length === 0) return [];
  const db = getDb();

  const leagueIds = members.map((m) => m.leagueId);
  const seasonByLeague = new Map(members.map((m) => [m.leagueId, m.season]));

  const [rosterRows, leagueRows] = await Promise.all([
    db
      .select({
        leagueId: schema.rosters.leagueId,
        rosterId: schema.rosters.rosterId,
        ownerId: schema.rosters.ownerId,
        wins: schema.rosters.wins,
        losses: schema.rosters.losses,
        ties: schema.rosters.ties,
        fpts: schema.rosters.fpts,
        fptsAgainst: schema.rosters.fptsAgainst,
      })
      .from(schema.rosters)
      .where(inArray(schema.rosters.leagueId, leagueIds)),
    db
      .select({
        id: schema.leagues.id,
        settings: schema.leagues.settings,
        winnersBracket: schema.leagues.winnersBracket,
      })
      .from(schema.leagues)
      .where(inArray(schema.leagues.id, leagueIds)),
  ]);

  // Newest season first so the first roster row we see for an owner is the
  // representative rosterId used for demo swaps and ManagerName fallbacks.
  const sortedRosters = [...rosterRows].sort((a, b) => {
    const sa = Number(seasonByLeague.get(a.leagueId) ?? 0);
    const sb = Number(seasonByLeague.get(b.leagueId) ?? 0);
    return sb - sa;
  });

  const ownerByRoster = new Map<string, string | null>();
  for (const r of rosterRows) {
    ownerByRoster.set(`${r.leagueId}:${r.rosterId}`, r.ownerId);
  }

  const byOwner = new Map<string, AllTimeStanding>();
  for (const r of sortedRosters) {
    if (!r.ownerId) continue;
    const existing = byOwner.get(r.ownerId);
    if (existing) {
      existing.wins += r.wins ?? 0;
      existing.losses += r.losses ?? 0;
      existing.ties += r.ties ?? 0;
      existing.fpts += r.fpts ?? 0;
      existing.fptsAgainst += r.fptsAgainst ?? 0;
      existing.seasonsPlayed += 1;
    } else {
      byOwner.set(r.ownerId, {
        ownerId: r.ownerId,
        rosterId: r.rosterId,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        ties: r.ties ?? 0,
        fpts: r.fpts ?? 0,
        fptsAgainst: r.fptsAgainst ?? 0,
        seasonsPlayed: 1,
        championshipYears: [],
      });
    }
  }

  for (const row of leagueRows) {
    const settings = row.settings as Record<string, unknown> | null;
    const numPlayoffTeams = (settings?.playoff_teams as number) ?? 6;
    const champRosterId = getChampionRosterFromBracket(
      row.winnersBracket as SleeperBracketMatchup[] | null,
      numPlayoffTeams,
    );
    if (champRosterId == null) continue;
    const ownerId = ownerByRoster.get(`${row.id}:${champRosterId}`);
    const season = seasonByLeague.get(row.id);
    if (!ownerId || !season) continue;
    byOwner.get(ownerId)?.championshipYears.push(season);
  }

  for (const owner of byOwner.values()) {
    owner.championshipYears.sort();
  }

  return Array.from(byOwner.values()).sort(
    (a, b) =>
      b.championshipYears.length - a.championshipYears.length ||
      b.wins - a.wins ||
      b.fpts - a.fpts,
  );
}
