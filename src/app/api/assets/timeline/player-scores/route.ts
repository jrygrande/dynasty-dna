import { NextRequest, NextResponse } from 'next/server';
import { getLeagueFamily, getPlayerInfo, buildTimelineFromEvents } from '@/services/assets';
import { getPlayerTimeline } from '@/repositories/assetEvents';
import { getPlayerScores } from '@/repositories/playerScores';
import { getLeagueSeasonMap } from '@/repositories/leagues';
import { calculatePositionalBenchmarks } from '@/services/positionalBenchmarks';
import { getDb } from '@/db/index';
import { rosters, users } from '@/db/schema';
import { and, inArray, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId') || searchParams.get('league_id');
    const playerId = searchParams.get('playerId') || searchParams.get('player_id');

    if (!leagueId || !playerId) {
      return NextResponse.json({ ok: false, error: 'leagueId and playerId required' }, { status: 400 });
    }

    console.log(`Fetching player scores for player ${playerId} in league ${leagueId}`);

    // Get league family
    const family = await getLeagueFamily(leagueId);
    console.log(`League family: ${family.length} leagues`);

    // Get player info
    const player = await getPlayerInfo(playerId);

    // Get season information for each league
    const leagueSeasonMap = await getLeagueSeasonMap(family);

    // Get roster-to-owner mapping for all leagues in family
    const db = await getDb();
    const rosterOwnerMap = new Map<string, { ownerId: string; ownerName: string }>();

    const rosterData = await db
      .select({
        rosterId: rosters.rosterId,
        leagueId: rosters.leagueId,
        ownerId: rosters.ownerId,
        ownerName: users.displayName,
        ownerUsername: users.username
      })
      .from(rosters)
      .leftJoin(users, eq(rosters.ownerId, users.id))
      .where(inArray(rosters.leagueId, family));

    rosterData.forEach(row => {
      const key = `${row.leagueId}-${row.rosterId}`;
      rosterOwnerMap.set(key, {
        ownerId: row.ownerId,
        ownerName: row.ownerName || row.ownerUsername || `Team ${row.rosterId}`
      });
    });

    // Get all player scores across league family
    const allScores = [];
    for (const familyLeagueId of family) {
      const scores = await getPlayerScores({
        leagueId: familyLeagueId,
        playerId
      });
      const season = leagueSeasonMap.get(familyLeagueId) || 'Unknown';
      allScores.push(...scores.map(score => {
        const rosterKey = `${familyLeagueId}-${score.rosterId}`;
        const ownerInfo = rosterOwnerMap.get(rosterKey);

        return {
          ...score,
          leagueId: familyLeagueId,
          season,
          ownerName: ownerInfo?.ownerName || `Team ${score.rosterId}`,
          ownerId: ownerInfo?.ownerId
        };
      }));
    }

    // Get transaction events for timeline markers
    let events: any[] = [];
    let enrichedTimeline: any[] = [];
    try {
      events = await getPlayerTimeline(family, playerId);
      console.log(`Found ${events.length} events for player ${playerId}`);

      // Build enriched timeline with full asset and user details for modal functionality
      enrichedTimeline = await buildTimelineFromEvents(events);
      console.log(`Enriched ${enrichedTimeline.length} timeline events`);
    } catch (error) {
      console.error('Error fetching player timeline:', error);
      events = []; // Continue with empty events array
      enrichedTimeline = [];
    }

    // Create ordered seasons from league family (oldest to newest)
    const seasons = Array.from(new Set(allScores.map(s => s.season)))
      .filter(s => s !== 'Unknown')
      .sort((a, b) => parseInt(a) - parseInt(b));

    // Create continuous positioning for scores
    let continuousPosition = 1;
    const seasonBoundaries = new Map<string, { start: number; end: number }>();

    // Group scores by season and week (exclude week 18)
    const scoresBySeasonWeek = new Map();
    allScores.forEach(score => {
      if (score.week === 18) return; // Exclude week 18
      const key = `${score.season}-${score.week}`;
      if (!scoresBySeasonWeek.has(key)) {
        scoresBySeasonWeek.set(key, {
          leagueId: score.leagueId,
          season: score.season,
          week: score.week,
          points: parseFloat(score.points as string),
          isStarter: score.isStarter,
          rosterId: score.rosterId,
          ownerName: score.ownerName,
          ownerId: score.ownerId
        });
      }
    });

    // Assign continuous positions
    const scoresWithPositions: any[] = [];
    for (const season of seasons) {
      const seasonStart = continuousPosition;
      const seasonScores = Array.from(scoresBySeasonWeek.values())
        .filter(s => s.season === season)
        .sort((a, b) => a.week - b.week);

      for (const score of seasonScores) {
        scoresWithPositions.push({
          ...score,
          position: continuousPosition++
        });
      }

      if (seasonScores.length > 0) {
        seasonBoundaries.set(season, {
          start: seasonStart,
          end: continuousPosition - 1
        });
      }
    }

    // Map enriched transaction events to their continuous positions with complete data
    const transactionsWithPositions = enrichedTimeline.map(event => {
      // Find the position for this transaction based on season and week
      const matchingScore = scoresWithPositions.find(s =>
        s.season === event.season && s.week === event.week
      );

      // Use enriched timeline data with complete asset and user information
      return {
        id: event.id,
        leagueId: event.leagueId,
        season: event.season,
        week: event.week,
        eventTime: event.eventTime,
        eventType: event.eventType,
        fromRosterId: event.fromRosterId,
        toRosterId: event.toRosterId,
        fromUser: event.fromUser || null,
        toUser: event.toUser || null,
        details: event.details,
        transactionId: event.transactionId,
        assetsInTransaction: event.assetsInTransaction || [], // Full enriched assets
        position: matchingScore ? matchingScore.position : null
      };
    }).filter(t => t.position !== null);

    // Calculate positional benchmarks if player position is available
    let benchmarks: any[] = [];
    if (player?.position && scoresWithPositions.length > 0) {
      console.log(`Calculating benchmarks for ${player.position} position`);

      try {
        const playerScoreWeeks = scoresWithPositions.map(score => ({
          season: score.season,
          week: score.week,
          position: score.position
        }));

        benchmarks = await calculatePositionalBenchmarks(
          family,
          player.position,
          playerScoreWeeks
        );

        console.log(`Calculated ${benchmarks.length} benchmark weeks for ${player.position}`);
      } catch (error) {
        console.error('Error calculating positional benchmarks:', error);
        benchmarks = [];
      }
    }

    // Create roster legend mapping
    const rosterLegend = Array.from(
      new Set(scoresWithPositions.map(s => s.rosterId))
    ).map(rosterId => {
      const sampleScore = scoresWithPositions.find(s => s.rosterId === rosterId);
      return {
        rosterId,
        ownerName: sampleScore?.ownerName || `Team ${rosterId}`,
        ownerId: sampleScore?.ownerId
      };
    });

    // Create timeline data with continuous positioning
    const timelineData = {
      scores: scoresWithPositions,
      transactions: transactionsWithPositions,
      seasonBoundaries: Array.from(seasonBoundaries.entries()).map(([season, boundary]) => ({
        season,
        start: boundary.start,
        end: boundary.end
      })),
      rosterLegend,
      benchmarks
    };

    return NextResponse.json({
      ok: true,
      player,
      family,
      timeline: timelineData
    });

  } catch (e: any) {
    console.error('Player scores API error:', e);
    return NextResponse.json({
      ok: false,
      error: e?.message || 'Failed to fetch player scores'
    }, { status: 500 });
  }
}