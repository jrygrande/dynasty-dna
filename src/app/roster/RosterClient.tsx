'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SeasonSelector, type SeasonOption } from '@/components/ui/SeasonSelector';
import { PlayerCard } from '@/components/roster/PlayerCard';
import { AcquisitionTypeBadge } from '@/components/roster/AcquisitionTypeBadge';
import { AcquisitionPieChart } from '@/components/charts/AcquisitionPieChart';
import { WeeklyPositionBarChart } from '@/components/charts/WeeklyPositionBarChart';
import type { RosterResponse, RosterPlayer } from '@/services/roster';

interface RosterClientProps {
  leagueId: string;
  rosterId: number;
}

type SortOption = 'production_rank' | 'start_percentage' | 'ppg_lineup' | 'ppg_roster';

export default function RosterClient({ leagueId, rosterId }: RosterClientProps) {
  const [rosterData, setRosterData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('production_rank');
  const [availableSeasons, setAvailableSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string>('current');

  // Fetch available seasons
  useEffect(() => {
    async function fetchSeasons() {
      try {
        const response = await fetch(`/api/leagues/${leagueId}/seasons`);
        if (response.ok) {
          const data = await response.json();
          if (data.ok && data.seasons) {
            const seasonOptions: SeasonOption[] = data.seasons.map((season: any) => ({
              value: season.season,
              label: `${season.season} Season`,
              description: season.leagueName
            }));
            setAvailableSeasons(seasonOptions);

            // Set current season as default if it exists
            if (seasonOptions.length > 0) {
              setSelectedSeason(seasonOptions[0].value);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching seasons:', err);
      }
    }

    fetchSeasons();
  }, [leagueId]);

  useEffect(() => {
    async function fetchRosterData() {
      try {
        let url = `/api/roster/${rosterId}?leagueId=${leagueId}`;

        // Add season parameter if not current
        if (selectedSeason !== 'current') {
          url += `&season=${selectedSeason}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (!data.ok) {
          throw new Error(data.error || 'Failed to fetch roster data');
        }

        setRosterData(data);
      } catch (err: any) {
        console.error('Error fetching roster data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (selectedSeason) {
      setLoading(true);
      fetchRosterData();
    }
  }, [leagueId, rosterId, selectedSeason]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading roster...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!rosterData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert>
          <AlertDescription>No roster data available</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { manager, currentAssets, analytics } = rosterData;

  const handlePlayerClick = (playerId: string, playerName: string) => {
    window.location.href = `/player-scoring?leagueId=${leagueId}&playerId=${playerId}&playerName=${encodeURIComponent(playerName)}`;
  };

  const handlePickClick = (season: string, round: number, originalRosterId: number) => {
    window.location.href = `/player-timeline?leagueId=${leagueId}&season=${season}&round=${round}&originalRosterId=${originalRosterId}`;
  };

  const sortPlayers = (players: RosterPlayer[], sortOption: SortOption): RosterPlayer[] => {
    return [...players].sort((a, b) => {
      let primarySort = 0;

      switch (sortOption) {
        case 'production_rank':
          primarySort = b.currentSeasonStats.positionPercentile - a.currentSeasonStats.positionPercentile;
          break;
        case 'start_percentage':
          primarySort = b.currentSeasonStats.startPercentage - a.currentSeasonStats.startPercentage;
          break;
        case 'ppg_lineup':
          primarySort = b.currentSeasonStats.ppgWhenStarting - a.currentSeasonStats.ppgWhenStarting;
          break;
        case 'ppg_roster':
          primarySort = b.currentSeasonStats.ppgSinceAcquiring - a.currentSeasonStats.ppgSinceAcquiring;
          break;
      }

      // If primary sort is tied, use production rank as tiebreaker (higher percentile first)
      if (primarySort === 0) {
        return b.currentSeasonStats.positionPercentile - a.currentSeasonStats.positionPercentile;
      }

      return primarySort;
    });
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header Section */}
      <div className="mb-8">
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-3xl">
                  {manager.teamName || 'Team Name Not Set'}
                </CardTitle>
                <div className="flex gap-6 text-sm text-muted-foreground mt-2">
                  <span>{manager.displayName || manager.username || 'Unknown Manager'}</span>
                </div>
              </div>
              {availableSeasons.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Season:</span>
                  <SeasonSelector
                    seasons={availableSeasons}
                    value={selectedSeason}
                    onValueChange={setSelectedSeason}
                  />
                </div>
              )}
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Main Content - Tabs */}
      <Tabs defaultValue="players" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="players">Players</TabsTrigger>
          <TabsTrigger value="picks">Draft Picks</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="players" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <CardTitle>Current Players ({currentAssets.players.length})</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Sort by:</span>
                  <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production_rank">Production Rank</SelectItem>
                      <SelectItem value="start_percentage">Start %</SelectItem>
                      <SelectItem value="ppg_lineup">PPG in Lineup</SelectItem>
                      <SelectItem value="ppg_roster">PPG on Roster</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {sortPlayers(currentAssets.players, sortBy).map((player) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    leagueId={leagueId}
                    leagueName="your league"
                    onPlayerClick={handlePlayerClick}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="picks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Draft Picks ({currentAssets.picks.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {['2026', '2027', '2028'].map((season) => {
                  const seasonPicks = currentAssets.picks.filter(pick => pick.season === season);
                  if (seasonPicks.length === 0) return null;

                  return (
                    <div key={season}>
                      <h3 className="text-xl font-semibold mb-3">{season} Draft ({seasonPicks.length} picks)</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        {seasonPicks.map((pick, index) => (
                          <Card
                            key={index}
                            className={`p-4 ${pick.acquisitionType !== 'original' ? 'hover:bg-muted/50 cursor-pointer transition-all duration-200 hover:shadow-md' : ''}`}
                            onClick={() => pick.acquisitionType !== 'original' && handlePickClick(pick.season, pick.round, pick.originalRosterId)}
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="font-semibold text-lg">Round {pick.round}</div>
                                <AcquisitionTypeBadge type={pick.acquisitionType} />
                              </div>
                              <div className="text-sm text-muted-foreground">
                                Originally: {pick.originalManagerName}
                              </div>
                              {pick.acquisitionType !== 'original' && (
                                <div className="text-xs text-muted-foreground">
                                  Acquired via trade • Click to view timeline
                                </div>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <AcquisitionPieChart data={analytics?.acquisitionTypeStats || {}} />
            <WeeklyPositionBarChart data={analytics?.weeklyScoresByPosition || []} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Position Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Position Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(
                    currentAssets.players.reduce((acc, player) => {
                      const pos = player.position || 'Unknown';
                      acc[pos] = (acc[pos] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)
                  ).map(([position, count]) => (
                    <div key={position} className="flex justify-between">
                      <span>{position}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Draft Capital Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Draft Capital</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {['2026', '2027', '2028'].map((season) => {
                    const seasonCount = currentAssets.picks.filter(pick => pick.season === season).length;
                    return (
                      <div key={season} className="flex justify-between">
                        <span>{season}</span>
                        <span className="font-medium">{seasonCount} picks</span>
                      </div>
                    );
                  })}
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between font-semibold">
                      <span>Total</span>
                      <span>{currentAssets.picks.length} picks</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Acquisition Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>Acquisition Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">Players by Acquisition Type</h4>
                  <div className="space-y-2">
                    {Object.entries(
                      currentAssets.players.reduce((acc, player) => {
                        acc[player.acquisitionType] = (acc[player.acquisitionType] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([type, count]) => (
                      <div key={type} className="flex justify-between">
                        <span className="capitalize">{type.replace('_', ' ')}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">Draft Picks by Type</h4>
                  <div className="space-y-2">
                    {Object.entries(
                      currentAssets.picks.reduce((acc, pick) => {
                        acc[pick.acquisitionType] = (acc[pick.acquisitionType] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([type, count]) => (
                      <div key={type} className="flex justify-between">
                        <span className="capitalize">{type.replace('_', ' ')}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}