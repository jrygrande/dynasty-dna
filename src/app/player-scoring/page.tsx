import { notFound } from 'next/navigation';
import PlayerScoringClient from './PlayerScoringClient';

interface PageProps {
  searchParams: {
    leagueId?: string;
    playerId?: string;
    playerName?: string;
  };
}

export default async function PlayerScoringPage({ searchParams }: PageProps) {
  const leagueId = searchParams.leagueId;
  const playerId = searchParams.playerId;
  const playerName = searchParams.playerName;

  if (!leagueId) {
    notFound();
  }

  if (!playerId && !playerName) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <PlayerScoringClient
        leagueId={leagueId}
        playerId={playerId}
        playerName={playerName}
      />
    </div>
  );
}