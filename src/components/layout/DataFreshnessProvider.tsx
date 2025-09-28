'use client';

import { useSearchParams } from 'next/navigation';
import { DataFreshnessWidget } from '@/components/ui/DataFreshnessWidget';

export function DataFreshnessProvider() {
  const searchParams = useSearchParams();
  const leagueId = searchParams.get('leagueId');

  return <DataFreshnessWidget leagueId={leagueId || undefined} />;
}