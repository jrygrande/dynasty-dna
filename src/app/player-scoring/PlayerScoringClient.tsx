'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import ScoringBarChart from '@/components/ScoringBarChart';
import TransactionDetailsModal from '@/components/TransactionDetailsModal';
import type { TimelineEvent } from '@/lib/api/assets';

interface PlayerScoringResponse {
  ok: boolean;
  player: {
    id: string;
    name: string;
    position: string | null;
    team: string | null;
    status: string | null;
  };
  family: string[];
  timeline: {
    scores: Array<{
      leagueId: string;
      season: string;
      week: number;
      points: number;
      isStarter: boolean;
      rosterId: number;
      position: number;
      ownerName: string;
      ownerId?: string;
    }>;
    transactions: Array<TimelineEvent & {
      position: number;
    }>;
    seasonBoundaries: Array<{
      season: string;
      start: number;
      end: number;
    }>;
    rosterLegend: Array<{
      rosterId: number;
      ownerName: string;
      ownerId?: string;
    }>;
    benchmarks?: Array<{
      season: string;
      week: number;
      position: number;
      median: number;
      topDecile: number;
      sampleSize: number;
    }>;
  };
  error?: string;
}

interface PlayerScoringClientProps {
  leagueId: string;
  playerId?: string;
  playerName?: string;
}

export default function PlayerScoringClient({ leagueId, playerId, playerName }: PlayerScoringClientProps) {
  const [data, setData] = useState<PlayerScoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<TimelineEvent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const url = new URL('/api/assets/timeline/player-scores', window.location.origin);
        url.searchParams.set('leagueId', leagueId);

        if (playerId) {
          url.searchParams.set('playerId', playerId);
        } else if (playerName) {
          url.searchParams.set('playerName', playerName);
        }

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.ok) {
          throw new Error(result.error || 'Failed to load player scoring data');
        }

        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    if (leagueId && (playerId || playerName)) {
      fetchData();
    }
  }, [leagueId, playerId, playerName]);

  const handleTransactionClick = (transaction: TimelineEvent) => {
    setSelectedTransaction(transaction);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTransaction(null);
  };

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Loading player scoring data...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <Alert className="border-destructive">
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">No data available</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      {/* Player Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">{data.player.name} - Scoring Timeline</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {data.player.position ?? '—'} · {data.player.team ?? 'FA'}
            </Badge>
            {data.player.status && (
              <Badge variant="outline">{data.player.status}</Badge>
            )}
            <span className="text-xs text-muted-foreground">ID: {data.player.id}</span>
          </div>
        </CardHeader>
      </Card>

      {/* League Family */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">League Family Scoring History</CardTitle>
          <div className="flex flex-wrap gap-2">
            {data.family.map((league) => (
              <Badge key={league} variant="outline" className="text-xs">
                {league}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {/* Bar Chart Visualization */}
          <ScoringBarChart
            scores={data.timeline.scores}
            transactions={data.timeline.transactions}
            seasonBoundaries={data.timeline.seasonBoundaries}
            rosterLegend={data.timeline.rosterLegend}
            benchmarks={data.timeline.benchmarks}
            playerPosition={data.player.position || undefined}
            onTransactionClick={handleTransactionClick}
          />
        </CardContent>
      </Card>

      {/* Transaction Details Modal */}
      <TransactionDetailsModal
        event={selectedTransaction}
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        playerId={data.player.id}
      />
    </div>
  );
}