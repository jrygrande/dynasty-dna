import LeagueStandings from './LeagueStandings';
import type { LeagueStandingsResponse, TeamStanding } from './api/league/standings/route';
import { APP_NAME } from '@/lib/constants';
import { Sleeper } from '@/lib/sleeper';

const DYNASTY_DOMINATION_LEAGUE_ID = '1191596293294166016';

async function getLeagueStandings(): Promise<LeagueStandingsResponse> {
  try {
    console.log(`Fetching standings for league ${DYNASTY_DOMINATION_LEAGUE_ID}`);

    // Fetch all required data from Sleeper API directly
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

    console.log(`Successfully processed ${teams.length} teams for ${league.name}`);

    return {
      leagueName: league.name || 'Dynasty Domination',
      season: league.season?.toString() || '2024',
      teams
    };
  } catch (error: any) {
    console.error('Error fetching league standings:', error);
    throw error;
  }
}

export default async function HomePage() {
  try {
    const data = await getLeagueStandings();

    return (
      <main className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          {/* Header Section */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2">{data.leagueName}</h1>
            <p className="text-lg text-muted-foreground">
              {data.season} Season Standings
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Powered by {APP_NAME}
            </p>
          </div>

          {/* Standings Grid */}
          <LeagueStandings teams={data.teams} />

          {/* Footer */}
          <div className="mt-12 text-center text-sm text-muted-foreground">
            <p>Click any team to view their roster details</p>
            <p className="mt-2">
              <a
                href="/api/health"
                className="hover:text-foreground transition-colors"
              >
                System Health Check
              </a>
            </p>
          </div>
        </div>
      </main>
    );
  } catch (error) {
    console.error('Error loading league standings:', error);

    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Unable to Load League</h1>
          <p className="text-muted-foreground mb-4">
            There was an error fetching the league standings.
          </p>
          <p className="text-sm text-muted-foreground">
            <a
              href="/api/health"
              className="hover:text-foreground transition-colors"
            >
              Check System Health
            </a>
          </p>
        </div>
      </main>
    );
  }
}

