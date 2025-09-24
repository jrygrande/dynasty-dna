'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TeamStanding } from './api/league/standings/route';
import { DYNASTY_DOMINATION_LEAGUE_ID } from '@/lib/constants';

interface LeagueStandingsProps {
  teams: TeamStanding[];
}

interface TeamCardProps {
  team: TeamStanding;
  rank: number;
}

function TeamCard({ team, rank }: TeamCardProps) {
  const handleTeamClick = () => {
    const url = `/roster?leagueId=${DYNASTY_DOMINATION_LEAGUE_ID}&rosterId=${team.rosterId}`;
    window.location.href = url;
  };

  const formatPoints = (points: number): string => {
    return points.toLocaleString('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  };

  const getRankDisplay = (rank: number): string => {
    if (rank === 1) return '🏆';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}.`;
  };

  return (
    <Card
      className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-[1.02] border-2 hover:border-primary/50"
      onClick={handleTeamClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-muted-foreground min-w-[2rem]">
              {getRankDisplay(rank)}
            </span>
            <div>
              <CardTitle className="text-lg leading-tight">
                {team.teamName || `Team ${team.rosterId}`}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {team.managerName}
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between items-center">
          <div className="text-center">
            <div className="text-2xl font-bold">
              {team.wins}-{team.losses}
              {team.ties > 0 && `-${team.ties}`}
            </div>
            <div className="text-xs text-muted-foreground">
              Record
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold text-primary">
              {formatPoints(team.totalPoints)}
            </div>
            <div className="text-xs text-muted-foreground">
              Points
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LeagueStandings({ teams }: LeagueStandingsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {teams.map((team, index) => (
        <TeamCard
          key={team.rosterId}
          team={team}
          rank={index + 1}
        />
      ))}
    </div>
  );
}