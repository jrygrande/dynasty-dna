import { getDb } from '@/db/index';
import { assetEvents, players, rosters, users, playerScores, leagues, tradedPicks } from '@/db/schema';
import { and, eq, desc, sql, isNotNull, inArray, gte, lt } from 'drizzle-orm';
import { getLeagueFamily } from '@/services/assets';
import { getCurrentSeason, getCurrentWeek } from '@/services/nfl';
import type { PlayerScore } from '@/types/playerPerformance';

export interface RosterPlayer {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  status: string | null;
  acquisitionDate: string;
  acquisitionType: string;
  currentSeasonStats: {
    startPercentage: number;
    ppgWhenStarting: number;
    ppgSinceAcquiring: number;
    positionPercentile: number;
  };
}

export interface RosterPick {
  season: string;
  round: number;
  originalRosterId: number;
  originalManagerName: string;
  acquisitionDate: string;
  acquisitionType: string;
}

export interface ManagerInfo {
  id: string;
  username: string | null;
  displayName: string | null;
}

export interface RosterResponse {
  manager: ManagerInfo;
  currentAssets: {
    players: RosterPlayer[];
    picks: RosterPick[];
  };
}

export async function getCurrentRosterAssets(leagueId: string, rosterId: number): Promise<RosterResponse> {
  const db = await getDb();

  // Get league family for historical tracking
  const family = await getLeagueFamily(leagueId);

  // Get manager info
  const managerResult = await db
    .select({
      id: rosters.ownerId,
      username: users.username,
      displayName: users.displayName,
    })
    .from(rosters)
    .leftJoin(users, eq(rosters.ownerId, users.id))
    .where(and(eq(rosters.leagueId, leagueId), eq(rosters.rosterId, rosterId)))
    .limit(1);

  if (!managerResult.length) {
    throw new Error(`Roster ${rosterId} not found in league ${leagueId}`);
  }

  const manager = managerResult[0];

  // Get current roster state from Sleeper API as the source of truth for current players
  const { Sleeper } = await import('@/lib/sleeper');
  const sleeperRosters = await Sleeper.getLeagueRosters(leagueId);
  const currentRoster = sleeperRosters.find(r => r.roster_id === rosterId);

  if (!currentRoster?.players) {
    throw new Error(`Could not find current roster data for roster ${rosterId}`);
  }

  // Get acquisition details for all current players in batch
  const currentPlayerIds = currentRoster.players;

  // Get all acquisition events for these players to this roster
  const allPlayerEvents = await db
    .select()
    .from(assetEvents)
    .where(
      and(
        inArray(assetEvents.leagueId, family),
        eq(assetEvents.assetKind, 'player'),
        inArray(assetEvents.playerId, currentPlayerIds),
        eq(assetEvents.toRosterId, rosterId)
      )
    )
    .orderBy(desc(assetEvents.season), desc(assetEvents.week), desc(assetEvents.eventTime));

  // Group by player and take the most recent event for each
  const playerAcquisitionMap = new Map<string, any>();

  for (const event of allPlayerEvents) {
    if (!playerAcquisitionMap.has(event.playerId!)) {
      playerAcquisitionMap.set(event.playerId!, event);
    }
  }

  // For players without acquisition events, create default entries
  for (const playerId of currentPlayerIds) {
    if (!playerAcquisitionMap.has(playerId)) {
      playerAcquisitionMap.set(playerId, {
        playerId,
        eventType: 'unknown',
        eventTime: new Date('2021-01-01'),
        toRosterId: rosterId,
        leagueId: leagueId
      });
    }
  }

  // Convert to the format expected by the rest of the function
  const currentAssets = Array.from(playerAcquisitionMap.values());

  // Get current season to filter picks
  const currentSeason = await getCurrentSeason();
  const currentSeasonInt = parseInt(currentSeason);

  // All current assets are now players (we'll get picks separately)
  const playerEvents = currentAssets;

  // Get all draft picks for this roster (including non-traded original picks)
  const allRosterPicks = await getAllRosterPicks(leagueId, rosterId, manager.id, currentSeasonInt);

  // Get player details and stats
  const rosterPlayers: RosterPlayer[] = [];

  if (playerEvents.length > 0) {
    const playerIds = playerEvents.map(e => e.playerId!);

    // Get player info
    const playersInfo = await db
      .select()
      .from(players)
      .where(inArray(players.id, playerIds));

    const playerInfoMap = new Map(playersInfo.map(p => [p.id, p]));

    // Get current season stats
    const playerStats = await getPlayerStatsForRoster(family, playerIds, currentSeason);

    for (const event of playerEvents) {
      const playerInfo = playerInfoMap.get(event.playerId!);
      const stats = playerStats.get(event.playerId!) || {
        startPercentage: 0,
        ppgWhenStarting: 0,
        ppgSinceAcquiring: 0,
        positionPercentile: 0,
      };

      if (playerInfo) {
        rosterPlayers.push({
          id: playerInfo.id,
          name: playerInfo.name,
          position: playerInfo.position,
          team: playerInfo.team,
          status: playerInfo.status,
          acquisitionDate: event.eventTime?.toISOString() || `${event.season}-01-01T00:00:00.000Z`,
          acquisitionType: event.eventType,
          currentSeasonStats: stats,
        });
      }
    }
  }

  // Use the computed roster picks
  const uniquePicks: RosterPick[] = allRosterPicks;

  return {
    manager: {
      id: manager.id,
      username: manager.username,
      displayName: manager.displayName,
    },
    currentAssets: {
      players: rosterPlayers,
      picks: uniquePicks,
    },
  };
}

async function getAllRosterPicks(
  leagueId: string,
  rosterId: number,
  userId: string,
  currentSeasonInt: number
): Promise<RosterPick[]> {
  const db = await getDb();

  // Get all roster managers for this league to map roster IDs to usernames
  const rosterManagers = await db
    .select({
      rosterId: rosters.rosterId,
      username: users.username,
      displayName: users.displayName,
    })
    .from(rosters)
    .leftJoin(users, eq(rosters.ownerId, users.id))
    .where(eq(rosters.leagueId, leagueId));

  const rosterManagerMap = new Map(
    rosterManagers.map(rm => [
      rm.rosterId,
      rm.displayName || rm.username || `Roster ${rm.rosterId}`
    ])
  );

  // Generate all default picks for this roster (3 years out, 4 rounds each)
  const futureYears = [currentSeasonInt + 1, currentSeasonInt + 2, currentSeasonInt + 3];
  const defaultPicks: RosterPick[] = [];

  for (const year of futureYears) {
    for (let round = 1; round <= 4; round++) {
      defaultPicks.push({
        season: String(year),
        round,
        originalRosterId: rosterId,
        originalManagerName: rosterManagerMap.get(rosterId) || `Roster ${rosterId}`,
        acquisitionDate: `${year - 3}-01-01T00:00:00.000Z`, // Year when provisioned (3 years prior)
        acquisitionType: 'original',
      });
    }
  }

  // Get all traded picks affecting this roster
  const tradedPicksData = await db
    .select()
    .from(tradedPicks)
    .where(
      and(
        eq(tradedPicks.leagueId, leagueId),
        gte(tradedPicks.season, String(currentSeasonInt + 1))
      )
    );

  // Find picks traded away from this roster
  const tradedAwayPicks = new Set<string>();

  // Find picks traded to this roster
  const tradedToPicks: RosterPick[] = [];

  for (const pick of tradedPicksData) {
    const pickKey = `${pick.season}-${pick.round}`;

    if (pick.originalRosterId === rosterId && pick.currentOwnerId !== userId) {
      // This roster's original pick was traded away
      tradedAwayPicks.add(pickKey);
    } else if (pick.currentOwnerId === userId && pick.originalRosterId !== rosterId) {
      // This roster acquired someone else's pick
      tradedToPicks.push({
        season: pick.season,
        round: pick.round,
        originalRosterId: pick.originalRosterId,
        originalManagerName: rosterManagerMap.get(pick.originalRosterId) || `Roster ${pick.originalRosterId}`,
        acquisitionDate: '2024-01-01T00:00:00.000Z', // Default date for traded picks
        acquisitionType: 'traded_pick',
      });
    }
  }

  // Filter out traded-away picks from default picks
  const remainingOriginalPicks = defaultPicks.filter(pick => {
    const pickKey = `${pick.season}-${pick.round}`;
    return !tradedAwayPicks.has(pickKey);
  });

  // Combine remaining original picks with acquired picks
  return [...remainingOriginalPicks, ...tradedToPicks];
}

async function getPlayerStatsForRoster(
  family: string[],
  playerIds: string[],
  currentSeason: string
): Promise<Map<string, RosterPlayer['currentSeasonStats']>> {
  const db = await getDb();
  const statsMap = new Map<string, RosterPlayer['currentSeasonStats']>();

  if (playerIds.length === 0) return statsMap;

  // Get current week to filter to only completed weeks
  const currentWeek = await getCurrentWeek();
  const completedWeeks = currentWeek - 1; // Only weeks with completed games

  // Get current season player scores for our players (only completed weeks)
  const seasonScores = await db
    .select({
      playerId: playerScores.playerId,
      points: playerScores.points,
      isStarter: playerScores.isStarter,
      week: playerScores.week,
      leagueId: playerScores.leagueId,
    })
    .from(playerScores)
    .innerJoin(leagues, eq(playerScores.leagueId, leagues.id))
    .where(
      and(
        inArray(playerScores.leagueId, family),
        inArray(playerScores.playerId, playerIds),
        eq(leagues.season, currentSeason),
        lt(playerScores.week, currentWeek)
      )
    );

  // Get all starter scores by position for percentile calculation (only completed weeks)
  const allStarterScores = await db
    .select({
      playerId: playerScores.playerId,
      points: playerScores.points,
      position: players.position,
    })
    .from(playerScores)
    .innerJoin(leagues, eq(playerScores.leagueId, leagues.id))
    .innerJoin(players, eq(playerScores.playerId, players.id))
    .where(
      and(
        inArray(playerScores.leagueId, family),
        eq(playerScores.isStarter, true),
        eq(leagues.season, currentSeason),
        lt(playerScores.week, currentWeek),
        isNotNull(players.position)
      )
    );

  // Calculate position-based percentiles
  const positionScores = new Map<string, number[]>();
  for (const score of allStarterScores) {
    if (!positionScores.has(score.position!)) {
      positionScores.set(score.position!, []);
    }
    positionScores.get(score.position!)!.push(parseFloat(score.points));
  }

  // Calculate PPG by position for percentiles
  const positionPPGMap = new Map<string, number[]>();
  const playerPositionMap = new Map<string, string>();

  // Group all starter scores by player and position
  const playerScoresByPosition = new Map<string, { position: string; scores: number[] }>();
  for (const score of allStarterScores) {
    const key = `${score.playerId}-${score.position}`;
    if (!playerScoresByPosition.has(key)) {
      playerScoresByPosition.set(key, { position: score.position!, scores: [] });
    }
    playerScoresByPosition.get(key)!.scores.push(parseFloat(score.points));
    playerPositionMap.set(score.playerId, score.position!);
  }

  // Calculate PPG for each player at their position (testing without scaling)
  for (const [, data] of playerScoresByPosition) {
    const ppg = data.scores.reduce((sum, pts) => sum + pts, 0) / data.scores.length;
    if (!positionPPGMap.has(data.position)) {
      positionPPGMap.set(data.position, []);
    }
    positionPPGMap.get(data.position)!.push(ppg);
  }

  // Group our players' scores and calculate stats
  const playerScoreMap = new Map<string, typeof seasonScores>();
  for (const score of seasonScores) {
    if (!playerScoreMap.has(score.playerId)) {
      playerScoreMap.set(score.playerId, []);
    }
    playerScoreMap.get(score.playerId)!.push(score);
  }

  for (const [playerId, scores] of playerScoreMap) {
    const totalGames = scores.length;
    const starterGames = scores.filter(s => s.isStarter).length;

    // Use points as-is (testing without scaling)
    const totalPoints = scores.reduce((sum, s) => sum + parseFloat(s.points), 0);
    const starterPoints = scores.filter(s => s.isStarter).reduce((sum, s) => sum + parseFloat(s.points), 0);

    // Metrics per requirements
    const startPercentage = completedWeeks > 0 ? (starterGames / completedWeeks) * 100 : 0;
    const ppgWhenStarting = starterGames > 0 ? starterPoints / starterGames : 0;
    const ppgSinceAcquiring = completedWeeks > 0 ? totalPoints / completedWeeks : 0; // TODO: Calculate from acquisition date

    // Calculate position percentile
    let positionPercentile = 0;
    const playerPosition = playerPositionMap.get(playerId);
    if (playerPosition && starterGames > 0 && positionPPGMap.has(playerPosition)) {
      const positionPPGs = positionPPGMap.get(playerPosition)!;
      const betterCount = positionPPGs.filter(otherPPG => otherPPG < ppgWhenStarting).length;
      positionPercentile = positionPPGs.length > 0 ? (betterCount / positionPPGs.length) * 100 : 0;
    }

    statsMap.set(playerId, {
      startPercentage: Math.round(startPercentage * 10) / 10,
      ppgWhenStarting: Math.round(ppgWhenStarting * 100) / 100,
      ppgSinceAcquiring: Math.round(ppgSinceAcquiring * 100) / 100,
      positionPercentile: Math.round(positionPercentile * 10) / 10,
    });
  }

  return statsMap;
}