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
  teamName: string | null;
}

export interface WeeklyScore {
  week: number;
  [acquisitionType: string]: number; // Dynamic keys for each acquisition type
}

export interface WeeklyPositionScore {
  week: number;
  [position: string]: number; // Dynamic keys for each position (QB, RB, WR, TE, etc.)
}

export interface AcquisitionTypeStats {
  points: number;
  ppg: number;
  rank: number;
  totalTeams: number;
}

export interface RosterResponse {
  manager: ManagerInfo;
  currentAssets: {
    players: RosterPlayer[];
    picks: RosterPick[];
  };
  analytics: {
    weeklyScoresByType: WeeklyScore[];
    weeklyScoresByPosition: WeeklyPositionScore[];
    acquisitionTypeStats: Record<string, AcquisitionTypeStats>;
  };
}

/**
 * Get appropriate week limits for a given season
 */
async function getSeasonWeekLimits(targetSeason: string): Promise<{ currentWeek: number; completedWeeks: number }> {
  const currentSeason = await getCurrentSeason();

  if (targetSeason === currentSeason) {
    // For current season, use actual current week
    const currentWeek = await getCurrentWeek();
    return { currentWeek, completedWeeks: currentWeek - 1 };
  } else {
    // For past seasons, assume all 18 weeks were played
    return { currentWeek: 19, completedWeeks: 18 }; // Week 19 so that week 18 is included (< 19)
  }
}

/**
 * Check if a player was on a specific roster during a specific season
 */
async function wasPlayerOnRosterInSeason(
  playerId: string,
  rosterId: number,
  family: string[],
  season: string
): Promise<boolean> {
  const db = await getDb();

  // Get all asset events for this player across all seasons
  const allEvents = await db
    .select()
    .from(assetEvents)
    .where(
      and(
        eq(assetEvents.playerId, playerId),
        inArray(assetEvents.leagueId, family)
      )
    )
    .orderBy(assetEvents.season, assetEvents.week, assetEvents.eventTime);

  // Track roster ownership through time
  let currentRosterId: number | null = null;
  let wasOnRosterInTargetSeason = false;

  for (const event of allEvents) {
    const eventSeason = event.season || '';

    // Update current roster based on event
    if (event.toRosterId !== null) {
      currentRosterId = event.toRosterId;
    }

    // If this event is in the target season or before, check if player is on our roster
    if (eventSeason <= season && currentRosterId === rosterId) {
      wasOnRosterInTargetSeason = true;
    }

    // If this event is after the target season and player left our roster, they weren't on roster in target season
    if (eventSeason > season) {
      break;
    }

    // If player was traded away from our roster in target season or before, update status
    if (eventSeason <= season && event.fromRosterId === rosterId && currentRosterId !== rosterId) {
      wasOnRosterInTargetSeason = false;
    }
  }

  // Also check if there are any player scores for this player on this roster in this season
  // This is a more direct way to verify they were actually on the roster
  const playerScoreCheck = await db
    .select()
    .from(playerScores)
    .leftJoin(leagues, eq(playerScores.leagueId, leagues.id))
    .where(
      and(
        eq(playerScores.playerId, playerId),
        eq(playerScores.rosterId, rosterId),
        eq(leagues.season, season),
        inArray(playerScores.leagueId, family)
      )
    )
    .limit(1);

  return playerScoreCheck.length > 0 || wasOnRosterInTargetSeason;
}

export async function getCurrentRosterAssets(
  leagueId: string,
  rosterId: number,
  options?: { season?: string }
): Promise<RosterResponse> {
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
  const [sleeperRosters, leagueUsers] = await Promise.all([
    Sleeper.getLeagueRosters(leagueId),
    Sleeper.getLeagueUsers(leagueId)
  ]);

  const currentRoster = sleeperRosters.find(r => r.roster_id === rosterId);

  if (!currentRoster?.players) {
    throw new Error(`Could not find current roster data for roster ${rosterId}`);
  }

  // Find the team name from league users metadata
  const leagueUser = leagueUsers.find(user => user.user_id === manager.id);
  const teamName = leagueUser?.metadata?.team_name || null;

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

  // Group by player and take the most recent event for each, with priority for trade events
  const playerAcquisitionMap = new Map<string, any>();

  // Define event type priority (higher = more priority)
  const getEventTypePriority = (eventType: string): number => {
    switch (eventType) {
      case 'trade': return 5;
      case 'draft_selected': return 4;
      case 'waiver_add': return 3;
      case 'free_agent_add': return 2;
      case 'add': return 1;
      default: return 0;
    }
  };

  for (const event of allPlayerEvents) {
    const playerId = event.playerId!;
    const existingEvent = playerAcquisitionMap.get(playerId);

    if (!existingEvent) {
      playerAcquisitionMap.set(playerId, event);
    } else {
      // If events are from the same time period, prioritize by event type
      const sameTime = existingEvent.season === event.season &&
                      existingEvent.week === event.week;

      if (sameTime) {
        const existingPriority = getEventTypePriority(existingEvent.eventType);
        const newPriority = getEventTypePriority(event.eventType);

        if (newPriority > existingPriority) {
          playerAcquisitionMap.set(playerId, event);
        }
      }
      // If different time periods, keep the most recent (already handled by orderBy)
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

  // Get season for stats calculation (use provided season or current season)
  const currentSeason = await getCurrentSeason();
  const targetSeason = options?.season || currentSeason;
  const currentSeasonInt = parseInt(targetSeason);

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

    // Get season-specific stats
    const playerStats = await getPlayerStatsForRoster(family, playerIds, targetSeason);

    for (const event of playerEvents) {
      const playerInfo = playerInfoMap.get(event.playerId!);
      let stats = playerStats.get(event.playerId!) || {
        startPercentage: 0,
        ppgWhenStarting: 0,
        ppgSinceAcquiring: 0,
        positionPercentile: 0,
      };

      // If viewing a historical season, check if player was on roster in that season
      if (options?.season && options.season !== currentSeason) {
        const wasOnRosterInSeason = await wasPlayerOnRosterInSeason(
          event.playerId!,
          rosterId,
          family,
          targetSeason
        );

        if (!wasOnRosterInSeason) {
          // Player wasn't on roster in the target season, show null stats
          stats = {
            startPercentage: -1, // Use -1 to indicate "no data" which UI will show as "-"
            ppgWhenStarting: -1,
            ppgSinceAcquiring: -1,
            positionPercentile: -1,
          };
        }
      }

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

  // Get analytics data
  // Use the existing playerAcquisitionMap for analytics
  const analyticsAcquisitionMap = new Map<string, string>();
  for (const [playerId, event] of playerAcquisitionMap) {
    analyticsAcquisitionMap.set(playerId, event.eventType);
  }

  const weeklyScoresByType = await getWeeklyScoresByAcquisitionType(family, rosterId, targetSeason, analyticsAcquisitionMap);
  const weeklyScoresByPosition = await getWeeklyScoresByPosition(family, rosterId, targetSeason);
  const leagueRosterPPG = await getLeagueRosterPPG(family, targetSeason);

  // Calculate acquisition type stats with rankings
  const acquisitionTypeStats: Record<string, AcquisitionTypeStats> = {};

  // Aggregate total points by acquisition type from weekly data
  const totalsByType: Record<string, number> = {};
  for (const weekData of weeklyScoresByType) {
    Object.keys(weekData).forEach(key => {
      if (key !== 'week') {
        totalsByType[key] = (totalsByType[key] || 0) + weekData[key];
      }
    });
  }

  // Calculate stats and rankings for each acquisition type
  const { currentWeek: analyticsCurrentWeek, completedWeeks: analyticsCompletedWeeks } = await getSeasonWeekLimits(targetSeason);

  Object.keys(totalsByType).forEach(acquisitionType => {
    const totalPoints = totalsByType[acquisitionType];
    const ppg = analyticsCompletedWeeks > 0 ? totalPoints / analyticsCompletedWeeks : 0;

    // Calculate ranking for this acquisition type
    const leagueData = leagueRosterPPG[acquisitionType] || {};
    const allPPGs = Object.values(leagueData).sort((a, b) => b - a);

  
    const rank = allPPGs.findIndex(value => value <= ppg) + 1;

    acquisitionTypeStats[acquisitionType] = {
      points: Math.round(totalPoints * 100) / 100,
      ppg: Math.round(ppg * 100) / 100,
      rank: rank || allPPGs.length + 1,
      totalTeams: allPPGs.length,
    };
  });

  return {
    manager: {
      id: manager.id,
      username: manager.username,
      displayName: manager.displayName,
      teamName: teamName,
    },
    currentAssets: {
      players: rosterPlayers,
      picks: uniquePicks,
    },
    analytics: {
      weeklyScoresByType,
      weeklyScoresByPosition,
      acquisitionTypeStats,
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
  targetSeason: string
): Promise<Map<string, RosterPlayer['currentSeasonStats']>> {
  const db = await getDb();
  const statsMap = new Map<string, RosterPlayer['currentSeasonStats']>();

  if (playerIds.length === 0) return statsMap;

  // Get appropriate week limits for the target season
  const { currentWeek, completedWeeks } = await getSeasonWeekLimits(targetSeason);

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
        eq(leagues.season, targetSeason),
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
        eq(leagues.season, targetSeason),
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

async function getWeeklyScoresByAcquisitionType(
  family: string[],
  rosterId: number,
  targetSeason: string,
  playerAcquisitionMap: Map<string, string>
): Promise<WeeklyScore[]> {
  const db = await getDb();

  // Get appropriate week limits for the target season
  const { currentWeek, completedWeeks } = await getSeasonWeekLimits(targetSeason);

  if (completedWeeks <= 0) {
    return [];
  }

  // Get all starter scores for this roster - simplified query to debug
  const weeklyData = await db
    .select({
      week: playerScores.week,
      points: playerScores.points,
      playerId: playerScores.playerId,
      leagueId: playerScores.leagueId,
    })
    .from(playerScores)
    .innerJoin(leagues, eq(playerScores.leagueId, leagues.id))
    .where(
      and(
        eq(playerScores.rosterId, rosterId),
        inArray(playerScores.leagueId, family),
        eq(leagues.season, targetSeason),
        eq(playerScores.isStarter, true), // Only starter points
        gte(playerScores.week, 1),
        lt(playerScores.week, currentWeek)
      )
    );


  // Group by week and acquisition type
  const weeklyScores: Record<number, Record<string, number>> = {};

  // Initialize weeks
  for (let week = 1; week <= completedWeeks; week++) {
    weeklyScores[week] = { week };
  }

  // Aggregate points by week and acquisition type
  for (const score of weeklyData) {
    const week = score.week;
    const acquisitionType = playerAcquisitionMap.get(score.playerId) || 'unknown';
    const points = parseFloat(score.points) || 0;

    if (!weeklyScores[week][acquisitionType]) {
      weeklyScores[week][acquisitionType] = 0;
    }
    weeklyScores[week][acquisitionType] += points;
  }


  // Convert to array and round values
  return Object.values(weeklyScores).map(weekData => {
    const result: WeeklyScore = { week: weekData.week };
    Object.keys(weekData).forEach(key => {
      if (key !== 'week') {
        result[key] = Math.round((weekData[key] || 0) * 100) / 100;
      }
    });
    return result;
  });
}

async function getLeagueRosterPPG(
  family: string[],
  targetSeason: string
): Promise<Record<string, Record<number, number>>> {
  const db = await getDb();

  // Get appropriate week limits for the target season
  const { currentWeek, completedWeeks } = await getSeasonWeekLimits(targetSeason);

  if (completedWeeks <= 0) {
    return {};
  }

  // Use a simplified approach: get all starter scores by acquisition type across all rosters
  // This query will get starter points aggregated by roster and acquisition type
  const leagueStarters = await db
    .select({
      rosterId: playerScores.rosterId,
      playerId: playerScores.playerId,
      totalPoints: sql<number>`sum(${playerScores.points}::numeric)`.as('totalPoints'),
    })
    .from(playerScores)
    .innerJoin(leagues, eq(playerScores.leagueId, leagues.id))
    .where(
      and(
        inArray(playerScores.leagueId, family),
        eq(leagues.season, targetSeason),
        eq(playerScores.isStarter, true),
        gte(playerScores.week, 1),
        lt(playerScores.week, currentWeek)
      )
    )
    .groupBy(playerScores.rosterId, playerScores.playerId);

  // Get all player acquisition data for starter players
  const allPlayerIds = [...new Set(leagueStarters.map(s => s.playerId))];
  const playerAcquisitions = await db
    .select()
    .from(assetEvents)
    .where(
      and(
        inArray(assetEvents.leagueId, family),
        eq(assetEvents.assetKind, 'player'),
        inArray(assetEvents.playerId, allPlayerIds)
      )
    )
    .orderBy(desc(assetEvents.season), desc(assetEvents.week), desc(assetEvents.eventTime));

  // Create acquisition map (player -> most recent acquisition event to current roster)
  const playerAcquisitionMap = new Map<string, string>();
  for (const event of playerAcquisitions) {
    const key = `${event.playerId}-${event.toRosterId}`;
    if (!playerAcquisitionMap.has(key)) {
      playerAcquisitionMap.set(key, event.eventType);
    }
  }


  // Map acquisition types to standardized categories
  const mapAcquisitionType = (type: string): string => {
    switch (type) {
      case 'free_agent_add':
        return 'free_agency';
      case 'add':
        return 'free_agency'; // Treat generic 'add' as free agency
      case 'unknown':
        return 'free_agency'; // Default unknown to free agency
      default:
        return type;
    }
  };

  // Aggregate points by roster and acquisition type
  const result: Record<string, Record<number, number>> = {
    trade: {},
    draft_selected: {},
    waiver_add: {},
    free_agency: {}
  };

  // Initialize all rosters with 0s
  for (let rosterId = 1; rosterId <= 12; rosterId++) {
    Object.keys(result).forEach(acquisitionType => {
      result[acquisitionType][rosterId] = 0;
    });
  }

  // Aggregate starter points by acquisition type
  for (const starter of leagueStarters) {
    const key = `${starter.playerId}-${starter.rosterId}`;
    const rawAcquisitionType = playerAcquisitionMap.get(key) || 'unknown';
    const acquisitionType = mapAcquisitionType(rawAcquisitionType);
    const points = parseFloat(starter.totalPoints?.toString() || '0');

    if (result[acquisitionType]) {
      result[acquisitionType][starter.rosterId] = (result[acquisitionType][starter.rosterId] || 0) + points;
    }
  }

  // Convert total points to PPG
  Object.keys(result).forEach(acquisitionType => {
    Object.keys(result[acquisitionType]).forEach(rosterIdStr => {
      const rosterId = parseInt(rosterIdStr);
      const totalPoints = result[acquisitionType][rosterId];
      result[acquisitionType][rosterId] = Math.round((totalPoints / completedWeeks) * 100) / 100;
    });
  });

  return result;
}

async function getWeeklyScoresByPosition(
  family: string[],
  rosterId: number,
  targetSeason: string
): Promise<WeeklyPositionScore[]> {
  const db = await getDb();

  // Get appropriate week limits for the target season
  const { currentWeek, completedWeeks } = await getSeasonWeekLimits(targetSeason);

  if (completedWeeks <= 0) {
    return [];
  }

  // Get all starter scores for this roster with position information
  const weeklyData = await db
    .select({
      week: playerScores.week,
      points: playerScores.points,
      playerId: playerScores.playerId,
      position: players.position,
    })
    .from(playerScores)
    .innerJoin(leagues, eq(playerScores.leagueId, leagues.id))
    .innerJoin(players, eq(playerScores.playerId, players.id))
    .where(
      and(
        eq(playerScores.rosterId, rosterId),
        inArray(playerScores.leagueId, family),
        eq(leagues.season, targetSeason),
        eq(playerScores.isStarter, true), // Only starter points
        gte(playerScores.week, 1),
        lt(playerScores.week, currentWeek),
        isNotNull(players.position)
      )
    );

  // Group by week and position
  const weeklyScores: Record<number, Record<string, number>> = {};

  // Initialize weeks
  for (let week = 1; week <= completedWeeks; week++) {
    weeklyScores[week] = { week };
  }

  // Aggregate points by week and position
  for (const score of weeklyData) {
    const week = score.week;
    const position = score.position || 'Unknown';
    const points = parseFloat(score.points) || 0;

    if (!weeklyScores[week][position]) {
      weeklyScores[week][position] = 0;
    }
    weeklyScores[week][position] += points;
  }

  // Convert to array and round values
  return Object.values(weeklyScores).map(weekData => {
    const result: WeeklyPositionScore = { week: weekData.week };
    Object.keys(weekData).forEach(key => {
      if (key !== 'week') {
        result[key] = Math.round((weekData[key] || 0) * 100) / 100;
      }
    });
    return result;
  });
}