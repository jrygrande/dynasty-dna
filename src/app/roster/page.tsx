import { notFound } from 'next/navigation';
import RosterClient from './RosterClient';

interface PageProps {
  searchParams: {
    leagueId?: string;
    rosterId?: string;
  };
}

export default async function RosterPage({ searchParams }: PageProps) {
  const leagueId = searchParams.leagueId;
  const rosterId = searchParams.rosterId;

  if (!leagueId) {
    notFound();
  }

  if (!rosterId) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <RosterClient
        leagueId={leagueId}
        rosterId={parseInt(rosterId)}
      />
    </div>
  );
}