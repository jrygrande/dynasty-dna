import LeagueStandings from './LeagueStandings';
import type { LeagueStandingsResponse } from './api/league/standings/route';
import { APP_NAME } from '@/lib/constants';

async function getLeagueStandings(): Promise<LeagueStandingsResponse> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const response = await fetch(`${baseUrl}/api/league/standings`, {
    cache: 'no-store', // Always fetch fresh data
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch league standings: ${response.status}`);
  }

  return response.json();
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

