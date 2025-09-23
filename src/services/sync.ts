import { Sleeper } from '@/lib/sleeper';
import { upsertLeague } from '@/repositories/leagues';
import { upsertRoster } from '@/repositories/rosters';
import { upsertUser } from '@/repositories/users';
import { upsertTransactions } from '@/repositories/transactions';
import { upsertMatchups } from '@/repositories/matchups';
import { upsertDrafts, upsertDraftPicks, replaceTradedPicks } from '@/repositories/drafts';
import { upsertPlayerScoresBulk } from '@/repositories/playerScores';

export type SyncResult = {
  leagueId: string;
  users: number;
  rosters: number;
  transactions: number;
  matchups: number;
  playerScores: number;
  drafts: number;
  draftPicks: number;
  tradedPicks: number;
};

import { createJob, updateJobProgress, completeJob, failJob } from './jobs';
import { getLeagueFamily } from './assets';

export async function syncLeague(leagueId: string, opts?: { season?: string; weeks?: number[] }) : Promise<SyncResult> {
  // League core
  const league = await Sleeper.getLeague(leagueId);
  await upsertLeague({
    id: league.league_id ?? leagueId,
    name: league.name ?? 'Unknown League',
    season: String(league.season ?? ''),
    previousLeagueId: league.previous_league_id ?? null,
    settings: league.settings ?? null,
  });

  // Users
  const leagueUsers = await Sleeper.getLeagueUsers(leagueId);
  for (const u of leagueUsers) {
    await upsertUser({ id: u.user_id, username: u.username ?? `user_${u.user_id}`, displayName: u.display_name ?? null });
  }

  // Rosters
  const leagueRosters = await Sleeper.getLeagueRosters(leagueId);
  for (const r of leagueRosters) {
    // r.owner_id may be null for orphaned; guard with empty string
    await upsertRoster({ leagueId, rosterId: Number(r.roster_id), ownerId: r.owner_id ?? 'unknown' });
  }

  // Build rosterId -> owner userId map for traded picks mapping
  const rosterOwnerById = new Map<number, string>();
  for (const r of leagueRosters) {
    const rid = Number(r.roster_id);
    const owner = r.owner_id ?? 'unknown';
    if (!Number.isNaN(rid)) rosterOwnerById.set(rid, owner);
  }

  // Determine weeks to pull
  let weeks: number[];
  if (opts?.weeks && opts.weeks.length) {
    weeks = opts.weeks;
  } else {
    const state = await Sleeper.getState();
    const currentWeek = Number(state.week ?? 18);
    weeks = Array.from({ length: Math.min(Math.max(currentWeek, 18), 18) }, (_, i) => i + 1);
  }

  let txCount = 0;
  let matchupCount = 0;
  let playerScoresCount = 0;
  let draftsCount = 0;
  let draftPicksCount = 0;
  let tradedPicksCount = 0;

  // Track job progress
  const jobId = await createJob('league_sync', leagueId, weeks.length);

  for (const week of weeks) {
    // Transactions
    const txs = await Sleeper.getTransactions(leagueId, week);
    const txRows = txs.map((t: any) => ({
      id: String(t.transaction_id ?? `${leagueId}-${week}-${Math.random()}`),
      leagueId,
      week,
      type: String(t.type ?? 'unknown'),
      payload: t,
    }));
    txCount += await upsertTransactions(txRows);

    // Matchups
    const mus = await Sleeper.getLeagueMatchups(leagueId, week);
    const muRows = mus.map((m: any) => ({
      leagueId,
      week,
      rosterId: Number(m.roster_id),
      starters: m.starters ?? null,
      players: m.players ?? null,
      points: m.points ?? 0,
    }));
    matchupCount += await upsertMatchups(muRows);

    // Player Scores - extract from matchup data
    const playerScoreRows: Array<{
      leagueId: string;
      week: number;
      rosterId: number;
      playerId: string;
      points: number;
      isStarter: boolean;
    }> = [];

    for (const m of mus) {
      const rosterId = Number(m.roster_id);
      const starters = Array.isArray(m.starters) ? m.starters : [];
      const startersPoints = Array.isArray(m.starters_points) ? m.starters_points : [];
      const playersPoints = m.players_points && typeof m.players_points === 'object' ? m.players_points : {};

      // Add starter scores
      starters.forEach((playerId: string, index: number) => {
        if (playerId && startersPoints[index] !== undefined) {
          playerScoreRows.push({
            leagueId,
            week,
            rosterId,
            playerId: String(playerId),
            points: Number(startersPoints[index]) || 0,
            isStarter: true,
          });
        }
      });

      // Add bench player scores
      Object.entries(playersPoints).forEach(([playerId, points]) => {
        if (playerId && !starters.includes(playerId)) {
          playerScoreRows.push({
            leagueId,
            week,
            rosterId,
            playerId: String(playerId),
            points: Number(points) || 0,
            isStarter: false,
          });
        }
      });
    }

    if (playerScoreRows.length > 0) {
      playerScoresCount += await upsertPlayerScoresBulk(playerScoreRows);
    }

    await updateJobProgress(jobId, week);
  }

  // Drafts and Draft Picks (non-week scoped)
  const leagueDrafts = await Sleeper.getDrafts(leagueId);
  const toSafeDate = (v: any): Date | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const min = Date.UTC(2000, 0, 1);
    const max = Date.UTC(2100, 0, 1);
    if (ms < min || ms > max) return null;
    return new Date(ms);
  };
  if (Array.isArray(leagueDrafts) && leagueDrafts.length) {
    const draftRows = leagueDrafts.map((d: any) => ({
      id: String(d.draft_id ?? d.id ?? ''),
      leagueId,
      season: String(d.season ?? league.season ?? ''),
      startTime: toSafeDate(d.start_time ?? d.start ?? null),
      settings: {
        type: d.type ?? null,
        status: d.status ?? null,
        settings: d.settings ?? null,
      },
    }));
    draftsCount += await upsertDrafts(draftRows);

    for (const d of leagueDrafts) {
      const did = String(d.draft_id ?? d.id ?? '');
      if (!did) continue;
      const picks = await Sleeper.getDraftPicks(did);
      const pickRows = picks.map((p: any) => ({
        draftId: did,
        pickNo: Number(p.pick_no ?? p.pick ?? 0),
        round: Number(p.round ?? 0),
        rosterId: p.roster_id != null ? Number(p.roster_id) : null,
        playerId: p.player_id != null ? String(p.player_id) : null,
        isKeeper: Boolean(p.is_keeper ?? false),
        tradedFromRosterId: p.metadata?.traded_from ? Number(p.metadata.traded_from) : null,
      }));
      draftPicksCount += await upsertDraftPicks(pickRows);
    }
  }

  // Traded Picks (snapshot per season)
  const tp = await Sleeper.getTradedPicks(leagueId);
  if (Array.isArray(tp) && tp.length) {
    // Group by season and replace per season for idempotency
    const bySeason = new Map<string, any[]>();
    for (const row of tp) {
      const s = String(row.season ?? league.season ?? '');
      if (!bySeason.has(s)) bySeason.set(s, []);
      bySeason.get(s)!.push(row);
    }
    for (const [s, rows] of bySeason) {
      const mapped = rows
        .map((r: any) => {
          const originalRosterId = Number(r.roster_id);
          // owner may be user_id or roster_id; normalize to user_id
          let currentOwnerUserId: string | undefined;
          if (typeof r.owner_id === 'string') currentOwnerUserId = r.owner_id;
          else if (typeof r.owner_id === 'number') currentOwnerUserId = rosterOwnerById.get(Number(r.owner_id));
          else currentOwnerUserId = rosterOwnerById.get(Number(r.roster_id));
          if (!originalRosterId || !currentOwnerUserId) return null;
          return {
            leagueId,
            season: s,
            round: Number(r.round ?? 0),
            originalRosterId,
            currentOwnerId: currentOwnerUserId,
          };
        })
        .filter(Boolean) as any[];
      tradedPicksCount += await replaceTradedPicks(leagueId, s, mapped);
    }
  }
  await completeJob(jobId);
  return {
    leagueId,
    users: leagueUsers.length,
    rosters: leagueRosters.length,
    transactions: txCount,
    matchups: matchupCount,
    playerScores: playerScoresCount,
    drafts: draftsCount,
    draftPicks: draftPicksCount,
    tradedPicks: tradedPicksCount,
  };
}

export type SyncUserResult = {
  userId: string;
  username?: string;
  leagues: { leagueId: string; result: SyncResult }[];
};

import { getUser, discoverDynastyLeaguesForUser } from './discovery';

export async function syncUser(input: { username?: string; userId?: string }): Promise<SyncUserResult> {
  const user = await getUser(input);
  const leagueIds = await discoverDynastyLeaguesForUser(user.user_id);
  const leagues: { leagueId: string; result: SyncResult }[] = [];
  for (const id of leagueIds) {
    const result = await syncLeague(id);
    leagues.push({ leagueId: id, result });
  }
  return { userId: user.user_id, username: user.username, leagues };
}

export async function syncLeagueFamily(rootLeagueId: string, opts?: { incremental?: boolean }) {
  const family = await getLeagueFamily(rootLeagueId);
  const results: { leagueId: string; result: SyncResult }[] = [];
  for (const id of family) {
    const result = await syncLeague(id);
    results.push({ leagueId: id, result });
  }

  // After syncing league data, run asset events sync
  if (opts?.incremental) {
    const { syncAssetEventsIncremental } = await import('./assets');
    const assetEventsResult = await syncAssetEventsIncremental(rootLeagueId);
    console.log(`Asset events incremental sync: ${assetEventsResult.eventsGenerated} events from ${assetEventsResult.transactionsProcessed} transactions`);
  } else {
    const { rebuildAssetEventsForLeagueFamily } = await import('./assets');
    const assetEventsResult = await rebuildAssetEventsForLeagueFamily(rootLeagueId);
    console.log(`Asset events full rebuild: ${assetEventsResult.events} events for ${assetEventsResult.leagues} leagues`);
  }

  return { leagues: family, results };
}
