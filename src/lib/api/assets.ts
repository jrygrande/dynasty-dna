import { z } from 'zod';

type FetcherInit = {
  baseUrl?: string;
  leagueId: string;
  playerId?: string | null;
  playerName?: string | null;
  revalidate?: number;
};

export const timelineUserSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
});

export const timelineAssetSchema = z.object({
  id: z.string(),
  assetKind: z.enum(['player', 'pick']),
  eventType: z.string(),
  playerId: z.string().nullable().optional(),
  playerName: z.string().nullable().optional(),
  playerPosition: z.string().nullable().optional(),
  playerTeam: z.string().nullable().optional(),
  pickSeason: z.string().nullable().optional(),
  pickRound: z.number().nullable().optional(),
  pickOriginalRosterId: z.number().nullable().optional(),
  fromRosterId: z.number().nullable().optional(),
  toRosterId: z.number().nullable().optional(),
  fromUser: timelineUserSchema.nullable().optional(),
  toUser: timelineUserSchema.nullable().optional(),
  details: z.unknown().optional(),
});

export const performanceMetricsSchema = z.object({
  startingPercentage: z.number(),
  ppg: z.number(),
  startingPpg: z.number(),
  weekCount: z.number(),
  season: z.string(),
});

export const timelineEventSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  season: z.string().nullable(),
  week: z.number().nullable(),
  eventTime: z.string().nullable(),
  eventType: z.string(),
  fromRosterId: z.number().nullable(),
  toRosterId: z.number().nullable(),
  fromUser: timelineUserSchema.nullable(),
  toUser: timelineUserSchema.nullable(),
  details: z.unknown().nullable(),
  transactionId: z.string().nullable(),
  assetsInTransaction: z.array(timelineAssetSchema).optional(),
  performanceMetrics: z.array(performanceMetricsSchema).optional(),
});

export const playerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string().nullable(),
  team: z.string().nullable(),
  status: z.string().nullable(),
});

export const playerTimelineResponseSchema = z.object({
  family: z.array(z.string()),
  player: playerSummarySchema,
  events: z.array(z.unknown()),
  timeline: z.array(timelineEventSchema),
});

export type TimelineUser = z.infer<typeof timelineUserSchema>;
export type TimelineAsset = z.infer<typeof timelineAssetSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type PlayerSummary = z.infer<typeof playerSummarySchema>;
export type PlayerTimelineResponse = z.infer<typeof playerTimelineResponseSchema>;
export type PerformanceMetrics = z.infer<typeof performanceMetricsSchema>;

const errorMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string().nullable(),
  team: z.string().nullable(),
});

const errorPayloadSchema = z.object({
  ok: z.literal(false).optional(),
  error: z.string().optional(),
  matches: z.array(errorMatchSchema).optional(),
});

export type PlayerTimelineErrorPayload = z.infer<typeof errorPayloadSchema>;

export class PlayerTimelineFetchError extends Error {
  status: number;
  payload?: PlayerTimelineErrorPayload | null;

  constructor(message: string, status: number, payload?: PlayerTimelineErrorPayload | null) {
    super(message);
    this.name = 'PlayerTimelineFetchError';
    this.status = status;
    this.payload = payload;
  }
}

const resolveBaseUrl = (explicit?: string): string => {
  if (explicit) return explicit.replace(/\/$/, '');
  const env =
    process.env.DNA_API_BASE_URL ||
    process.env.NEXT_PUBLIC_DNA_API_BASE_URL ||
    process.env.DNA_ASSETS_API_BASE_URL ||
    process.env.NEXT_PUBLIC_DNA_ASSETS_API_BASE_URL;
  return (env ? env.replace(/\/$/, '') : 'http://localhost:3002') as string;
};

export async function fetchTimelineForAsset(asset: TimelineAsset, leagueId: string, baseUrl?: string): Promise<PlayerTimelineResponse> {
  if (asset.assetKind === 'player') {
    return fetchPlayerTimeline({
      baseUrl,
      leagueId,
      playerId: asset.playerId || asset.id,
      playerName: asset.playerName
    });
  } else {
    // For picks, we'll use the pick timeline endpoint
    return fetchPickTimeline({
      baseUrl,
      leagueId,
      season: asset.pickSeason!,
      round: asset.pickRound!,
      originalRosterId: asset.pickOriginalRosterId!
    });
  }
}

export async function fetchPickTimeline(init: {
  baseUrl?: string;
  leagueId: string;
  season: string;
  round: number;
  originalRosterId: number;
  revalidate?: number;
}): Promise<PlayerTimelineResponse> {
  const { baseUrl, leagueId, season, round, originalRosterId, revalidate } = init;
  if (!leagueId || !season || !round || !originalRosterId) {
    throw new PlayerTimelineFetchError('leagueId, season, round, and originalRosterId are required to fetch a pick timeline', 400);
  }

  const url = new URL('/api/assets/timeline/pick', resolveBaseUrl(baseUrl));
  url.searchParams.set('leagueId', leagueId);
  url.searchParams.set('season', season);
  url.searchParams.set('round', round.toString());
  url.searchParams.set('originalRosterId', originalRosterId.toString());

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    next: revalidate != null ? { revalidate } : undefined,
    cache: revalidate != null ? undefined : 'no-store',
  });

  const rawText = await response.text();
  const rawData = rawText ? (() => {
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  })() : null;

  if (!response.ok) {
    const parsedError = rawData && typeof rawData === 'object' ? errorPayloadSchema.safeParse(rawData) : null;
    const payload = parsedError?.success ? parsedError.data : null;
    const message = payload?.error || response.statusText || 'Failed to load pick timeline';
    throw new PlayerTimelineFetchError(message, response.status, payload);
  }

  const parsed = playerTimelineResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new PlayerTimelineFetchError('Pick timeline payload was not in the expected format', 500);
  }

  return parsed.data;
}

export async function fetchPlayerTimeline(init: FetcherInit): Promise<PlayerTimelineResponse> {
  const { baseUrl, leagueId, playerId, playerName, revalidate } = init;
  if (!leagueId) {
    throw new PlayerTimelineFetchError('leagueId is required to fetch a player timeline', 400);
  }
  if (!playerId && !playerName) {
    throw new PlayerTimelineFetchError('Either playerId or playerName must be provided', 400);
  }

  const url = new URL('/api/assets/timeline/player', resolveBaseUrl(baseUrl));
  url.searchParams.set('leagueId', leagueId);
  if (playerId) {
    url.searchParams.set('playerId', playerId);
  } else if (playerName) {
    url.searchParams.set('playerName', playerName);
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    next: revalidate != null ? { revalidate } : undefined,
    cache: revalidate != null ? undefined : 'no-store',
  });

  const rawText = await response.text();
  const rawData = rawText ? (() => {
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  })() : null;

  if (!response.ok) {
    const parsedError = rawData && typeof rawData === 'object' ? errorPayloadSchema.safeParse(rawData) : null;
    const payload = parsedError?.success ? parsedError.data : null;
    const message = payload?.error || response.statusText || 'Failed to load player timeline';
    throw new PlayerTimelineFetchError(message, response.status, payload);
  }

  const parsed = playerTimelineResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new PlayerTimelineFetchError('Player timeline payload was not in the expected format', 500);
  }

  return parsed.data;
}
