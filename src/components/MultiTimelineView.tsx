'use client';

import { useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Users } from 'lucide-react';
import type { PlayerTimelineResponse, TimelineAsset } from '@/lib/api/assets';
import PlayerTimelineClient from '@/app/player-timeline/PlayerTimelineClient';

interface Timeline {
  id: string;
  title: string;
  data: PlayerTimelineResponse | null;
  loading: boolean;
  error: string | null;
  asset: TimelineAsset;
}

interface MultiTimelineViewProps {
  initialTimeline: {
    data: PlayerTimelineResponse;
    conflicts?: any;
  };
  leagueId: string;
}

export default function MultiTimelineView({ initialTimeline, leagueId }: MultiTimelineViewProps) {
  const [timelines, setTimelines] = useState<Timeline[]>([
    {
      id: 'initial',
      title: initialTimeline.data.player.name,
      data: initialTimeline.data,
      loading: false,
      error: null,
      asset: {
        id: initialTimeline.data.player.id,
        assetKind: 'player',
        eventType: '',
        playerName: initialTimeline.data.player.name,
        playerPosition: initialTimeline.data.player.position,
        playerTeam: initialTimeline.data.player.team,
        playerId: initialTimeline.data.player.id,
      }
    }
  ]);
  const [activeTab, setActiveTab] = useState('initial');

  const loadTimelineForAsset = useCallback(async (asset: TimelineAsset): Promise<PlayerTimelineResponse> => {
    if (asset.assetKind === 'player') {
      const url = new URL('/api/assets/timeline/player', window.location.origin);
      url.searchParams.set('leagueId', leagueId);
      url.searchParams.set('playerId', asset.playerId || asset.id);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Failed to load player timeline: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to load player timeline');
      }

      return data;
    } else {
      // For picks
      const url = new URL('/api/assets/timeline/pick', window.location.origin);
      url.searchParams.set('leagueId', leagueId);
      url.searchParams.set('season', asset.pickSeason!);
      url.searchParams.set('round', asset.pickRound!.toString());
      url.searchParams.set('originalRosterId', asset.pickOriginalRosterId!.toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Failed to load pick timeline: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to load pick timeline');
      }

      return data;
    }
  }, [leagueId]);

  const handleAssetClick = useCallback(async (asset: TimelineAsset) => {
    const timelineId = `${asset.assetKind}-${asset.id}`;

    // Check if timeline already exists
    const existingTimeline = timelines.find(t => t.id === timelineId);
    if (existingTimeline) {
      setActiveTab(timelineId);
      return;
    }

    // Create new timeline
    const newTimeline: Timeline = {
      id: timelineId,
      title: asset.assetKind === 'player'
        ? asset.playerName || `Player ${asset.id}`
        : `${asset.pickSeason} R${asset.pickRound} Pick`,
      data: null,
      loading: true,
      error: null,
      asset
    };

    setTimelines(prev => [...prev, newTimeline]);
    setActiveTab(timelineId);

    try {
      const timelineData = await loadTimelineForAsset(asset);
      setTimelines(prev => prev.map(t =>
        t.id === timelineId
          ? { ...t, data: timelineData, loading: false }
          : t
      ));
    } catch (error) {
      setTimelines(prev => prev.map(t =>
        t.id === timelineId
          ? { ...t, loading: false, error: error instanceof Error ? error.message : 'Failed to load timeline' }
          : t
      ));
    }
  }, [timelines, loadTimelineForAsset]);

  const closeTimeline = useCallback((timelineId: string) => {
    if (timelineId === 'initial') return; // Can't close initial timeline

    setTimelines(prev => prev.filter(t => t.id !== timelineId));

    // Switch to initial tab if we're closing the active tab
    if (activeTab === timelineId) {
      setActiveTab('initial');
    }
  }, [activeTab]);

  const renderTimelineContent = (timeline: Timeline) => {
    if (timeline.loading) {
      return (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Loading timeline...</p>
          </CardContent>
        </Card>
      );
    }

    if (timeline.error) {
      return (
        <Card className="border-destructive">
          <CardContent className="p-6 text-center">
            <p className="text-destructive">{timeline.error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => handleAssetClick(timeline.asset)}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      );
    }

    if (!timeline.data) {
      return (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">No data available</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <PlayerTimelineClient
        data={timeline.data}
        conflicts={timeline.id === 'initial' ? initialTimeline.conflicts : undefined}
        onAssetClick={handleAssetClick}
      />
    );
  };

  return (
    <div className="w-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
          <div className="container py-2">
            <TabsList className="grid w-full grid-cols-auto gap-2 bg-transparent h-auto p-0">
              {timelines.map((timeline) => (
                <div key={timeline.id} className="flex items-center">
                  <TabsTrigger
                    value={timeline.id}
                    className="flex items-center gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm border"
                  >
                    <div className="flex items-center gap-2">
                      {timeline.asset.assetKind === 'player' ? (
                        <Users className="h-4 w-4" />
                      ) : (
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          R{timeline.asset.pickRound}
                        </Badge>
                      )}
                      <span className="truncate max-w-32">{timeline.title}</span>
                      {timeline.loading && (
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                      )}
                    </div>
                    {timeline.id !== 'initial' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground ml-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTimeline(timeline.id);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </TabsTrigger>
                </div>
              ))}
            </TabsList>
          </div>
        </div>

        {timelines.map((timeline) => (
          <TabsContent key={timeline.id} value={timeline.id} className="mt-6">
            {renderTimelineContent(timeline)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}