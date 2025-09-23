import PlayerTimelineClient from './PlayerTimelineClient';
import MultiTimelineView from '@/components/MultiTimelineView';
import {
  PlayerTimelineErrorPayload,
  PlayerTimelineFetchError,
  PlayerTimelineResponse,
  fetchPlayerTimeline,
  fetchPickTimeline,
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

  // Pick parameters
  const season = coerceParam(searchParams.season);
  const roundStr = coerceParam(searchParams.round);
  const originalRosterIdStr = coerceParam(searchParams.originalRosterId);

  const round = roundStr ? parseInt(roundStr, 10) : undefined;
  const originalRosterId = originalRosterIdStr ? parseInt(originalRosterIdStr, 10) : undefined;

  const isPlayerRequest = playerId || playerName;
  const isPickRequest = season && round !== undefined && originalRosterId !== undefined;

  if (!leagueId || (!isPlayerRequest && !isPickRequest)) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 px-6 text-center text-slate-700">
        <h1 className="text-3xl font-semibold text-slate-900">Asset Timeline</h1>
        <p className="text-sm text-slate-600">
          Provide a <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">leagueId</code> and either:
        </p>
        <div className="text-sm text-slate-600 space-y-2">
          <p>For a player: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">playerId</code> or <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">playerName</code></p>
          <p>For a pick: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">season</code>, <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">round</code>, and <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">originalRosterId</code></p>
        </div>
        <div className="text-xs text-slate-500 space-y-1">
          <p>Player example: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/player-timeline?leagueId=123&playerName=Saquon%20Barkley</code></p>
          <p>Pick example: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/player-timeline?leagueId=123&season=2026&round=1&originalRosterId=3</code></p>
        </div>
      </main>
    );
  }

  let data: PlayerTimelineResponse | null = null;
  let conflicts: PlayerTimelineErrorPayload['matches'] | undefined;
  let errorMessage: string | null = null;

  try {
    if (isPlayerRequest) {
      data = await fetchPlayerTimeline({
        baseUrl: process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined,
        leagueId,
        playerId,
        playerName
      });
    } else if (isPickRequest) {
      data = await fetchPickTimeline({
        baseUrl: process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined,
        leagueId,
        season: season!,
        round: round!,
        originalRosterId: originalRosterId!
      });
    }
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
          <h1 className="text-3xl font-semibold text-slate-900">Asset Timeline</h1>
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
