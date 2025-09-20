import PlayerTimelineClient from './PlayerTimelineClient';
import MultiTimelineView from '@/components/MultiTimelineView';
import {
  PlayerTimelineErrorPayload,
  PlayerTimelineFetchError,
  PlayerTimelineResponse,
  fetchPlayerTimeline,
} from '@/lib/api/assets';

const coerceParam = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
};

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function PlayerTimelinePage({ searchParams }: PageProps) {
  const leagueId = coerceParam(searchParams.leagueId);
  const playerId = coerceParam(searchParams.playerId);
  const playerName = coerceParam(searchParams.playerName);

  if (!leagueId || (!playerId && !playerName)) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 px-6 text-center text-slate-700">
        <h1 className="text-3xl font-semibold text-slate-900">Player Timeline</h1>
        <p className="text-sm text-slate-600">
          Provide a <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">leagueId</code> and either a{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">playerId</code> or{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">playerName</code> in the query string to load a timeline.
        </p>
        <p className="text-xs text-slate-500">
          Example: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/player-timeline?leagueId=123&playerName=Saquon%20Barkley</code>
        </p>
      </main>
    );
  }

  let data: PlayerTimelineResponse | null = null;
  let conflicts: PlayerTimelineErrorPayload['matches'] | undefined;
  let errorMessage: string | null = null;

  try {
    data = await fetchPlayerTimeline({
      baseUrl: process.env.NODE_ENV === 'development' ? 'http://localhost:3002' : undefined,
      leagueId,
      playerId,
      playerName
    });
  } catch (error) {
    if (error instanceof PlayerTimelineFetchError) {
      errorMessage = error.message;
      conflicts = error.payload?.matches;
    } else {
      errorMessage = 'Unexpected error loading timeline';
    }
  }

  if (errorMessage) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-12 text-slate-700">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Player Timeline</h1>
          <p className="mt-2 text-sm text-slate-600">We could not load the requested timeline.</p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {errorMessage}
        </div>
        {conflicts?.length ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Multiple players match that request:</p>
            <ul className="mt-2 space-y-1">
              {conflicts.map((match) => (
                <li key={match.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{match.name}</span>
                  <span className="text-xs text-amber-700">
                    {match.position ?? '—'} · {match.team ?? '—'} · ID: {match.id}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 px-6 text-center text-slate-700">
        <p>Loading timeline…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <MultiTimelineView
        initialTimeline={{ data, conflicts }}
        leagueId={leagueId!}
      />
    </main>
  );
}
