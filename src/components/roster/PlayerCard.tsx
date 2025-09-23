import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { PositionBadge } from './PositionBadge';
import { AcquisitionTypeBadge } from './AcquisitionTypeBadge';
import { PercentileBar } from './PercentileBar';
import type { RosterPlayer } from '@/services/roster';

interface PlayerCardProps {
  player: RosterPlayer;
  leagueId: string;
  leagueName?: string;
  onPlayerClick: (playerId: string, playerName: string) => void;
}

export function PlayerCard({ player, leagueId, leagueName, onPlayerClick }: PlayerCardProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric'
    });
  };

  const getStartPercentageColor = (percentage: number) => {
    if (percentage >= 75) return 'text-green-600 dark:text-green-400';
    if (percentage >= 50) return 'text-blue-600 dark:text-blue-400';
    if (percentage >= 25) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <Card
      className="hover:bg-muted/50 cursor-pointer transition-all duration-200 hover:shadow-md"
      onClick={() => onPlayerClick(player.id, player.name)}
    >
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Player Info */}
          <div className="flex items-center space-x-3">
            <div className="space-y-1">
              <div className="font-medium text-lg">{player.name}</div>
              <div className="flex items-center space-x-2">
                <PositionBadge position={player.position} />
                <span className="text-sm text-muted-foreground">
                  {player.team || 'FA'} • {player.status}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                <span>Acquired {formatDate(player.acquisitionDate)}</span>
                <AcquisitionTypeBadge type={player.acquisitionType} />
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm lg:min-w-0 lg:flex-1 lg:max-w-2xl lg:ml-4">
            <div className="space-y-1">
              <div className="text-muted-foreground">Start %</div>
              <div className={`font-medium ${getStartPercentageColor(player.currentSeasonStats.startPercentage)}`}>
                {player.currentSeasonStats.startPercentage}%
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">PPG in Lineup</div>
              <div className="font-medium">
                {player.currentSeasonStats.ppgWhenStarting}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">PPG on Roster</div>
              <div className="font-medium">
                {player.currentSeasonStats.ppgSinceAcquiring}
              </div>
            </div>
            <div className="space-y-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-muted-foreground cursor-help">Production Rank</div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">
                      This player's performance in your starting lineup compared to all players started at {player.position || 'this position'} in {leagueName || 'this league'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <PercentileBar
                percentile={player.currentSeasonStats.positionPercentile}
                className="max-w-full lg:max-w-24"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}