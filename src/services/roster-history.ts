import { getDb } from '@/db/index';
import { leagues } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getLeagueFamily } from '@/services/assets';

export interface AvailableSeason {
  season: string;
  leagueId: string;
  leagueName: string;
}

/**
 * Get all available seasons for a league family
 */
export async function getAvailableSeasons(leagueId: string): Promise<AvailableSeason[]> {
  const db = await getDb();

  // Get the league family (current + all previous leagues)
  const family = await getLeagueFamily(leagueId);

  if (family.length === 0) {
    return [];
  }

  // Get season info for all leagues in the family
  const leagueData = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      season: leagues.season,
    })
    .from(leagues)
    .where(inArray(leagues.id, family));

  // Convert to AvailableSeason format and sort by season (newest first)
  const seasons = leagueData
    .filter(league => league.season) // Only include leagues with valid seasons
    .map(league => ({
      season: league.season,
      leagueId: league.id,
      leagueName: league.name,
    }))
    .sort((a, b) => parseInt(b.season) - parseInt(a.season)); // Sort newest first

  return seasons;
}

/**
 * Get the current season from the league family
 */
export async function getCurrentSeasonForLeague(leagueId: string): Promise<string | null> {
  const seasons = await getAvailableSeasons(leagueId);

  if (seasons.length === 0) {
    return null;
  }

  // Return the newest season (first in sorted array)
  return seasons[0].season;
}

/**
 * Find the league ID for a specific season in the family
 */
export async function getLeagueIdForSeason(rootLeagueId: string, targetSeason: string): Promise<string | null> {
  const seasons = await getAvailableSeasons(rootLeagueId);

  const seasonData = seasons.find(s => s.season === targetSeason);
  return seasonData?.leagueId || null;
}

/**
 * Check if a season exists in the league family
 */
export async function isValidSeason(leagueId: string, season: string): Promise<boolean> {
  const seasons = await getAvailableSeasons(leagueId);
  return seasons.some(s => s.season === season);
}