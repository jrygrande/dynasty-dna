import { NextResponse } from 'next/server';
import { Sleeper } from '@/lib/sleeper';

export interface TeamStanding {
  rosterId: number;
  teamName: string | null;
  managerName: string;
  wins: number;
  losses: number;
  ties: number;
  totalPoints: number;
}

export interface LeagueStandingsResponse {
  leagueName: string;
  season: string;
  teams: TeamStanding[];
}

const DYNASTY_DOMINATION_LEAGUE_ID = '1191596293294166016';

export async function GET() {
  try {
    console.log(`Fetching standings for league ${DYNASTY_DOMINATION_LEAGUE_ID}`);

    // Fetch all required data from Sleeper API
    const [league, rosters, users] = await Promise.all([
      Sleeper.getLeague(DYNASTY_DOMINATION_LEAGUE_ID),
      Sleeper.getLeagueRosters(DYNASTY_DOMINATION_LEAGUE_ID),
      Sleeper.getLeagueUsers(DYNASTY_DOMINATION_LEAGUE_ID)
    ]);

    // Create user lookup map
    const userMap = new Map(users.map(user => [user.user_id, user]));

    // Process rosters into team standings
    const teams: TeamStanding[] = rosters.map(roster => {
      const user = userMap.get(roster.owner_id);
      const settings = roster.settings || {};

      return {
        rosterId: roster.roster_id,
        teamName: user?.metadata?.team_name || null,
        managerName: user?.display_name || user?.username || `Manager ${roster.roster_id}`,
        wins: settings.wins || 0,
        losses: settings.losses || 0,
        ties: settings.ties || 0,
        totalPoints: parseFloat(settings.fpts?.toString() || '0')
      };
    });

    // Sort teams by wins (descending), then by total points (descending) as tiebreaker
    teams.sort((a, b) => {
      if (a.wins !== b.wins) {
        return b.wins - a.wins; // More wins first
      }
      return b.totalPoints - a.totalPoints; // Higher points first
    });

    const response: LeagueStandingsResponse = {
      leagueName: league.name || 'Dynasty Domination',
      season: league.season?.toString() || '2024',
      teams
    };

    console.log(`Successfully processed ${teams.length} teams for ${league.name}`);

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('League standings API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch league standings' },
      { status: 500 }
    );
  }
}