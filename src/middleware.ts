import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Only process roster and player-scoring pages
  if (!pathname.startsWith('/roster') && !pathname.startsWith('/player-scoring')) {
    return NextResponse.next();
  }

  const leagueId = searchParams.get('leagueId');
  if (!leagueId) {
    return NextResponse.next();
  }

  try {
    // Check if league data is stale
    const isStale = await checkIfLeagueDataIsStale(leagueId);

    if (isStale) {
      // Trigger background sync (non-blocking)
      // Use request origin for URL construction (works in all environments)
      const origin = request.nextUrl.origin;
      triggerBackgroundSync(leagueId, origin);
    } else {
      console.log(`[Middleware] League ${leagueId} data is fresh, skipping sync`);
    }

    // Continue with the request
    return NextResponse.next();
  } catch (error) {
    console.error('[Middleware] Sync check error:', error);
    // Don't block the request on errors
    return NextResponse.next();
  }
}

async function checkIfLeagueDataIsStale(leagueId: string): Promise<boolean> {
  try {
    // Import directly to avoid middleware fetch issues
    const { isLeagueDataStale } = await import('@/repositories/leagues');

    // Get current hour to determine staleness threshold
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

    // Determine staleness threshold based on time and season
    let thresholdHours = getDataStalenessThreshold(currentDay, currentHour);

    return await isLeagueDataStale(leagueId, thresholdHours);
  } catch (error) {
    console.error('Error checking staleness:', error);
    return false;
  }
}

function getDataStalenessThreshold(dayOfWeek: number, hour: number): number {
  // Determine if we're in NFL season (roughly September through January)
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const isNFLSeason = month >= 8 || month <= 0; // Sep-Jan

  if (!isNFLSeason) {
    // Off-season: 24 hour threshold
    return 24;
  }

  // During NFL season, use dynamic thresholds
  const isSunday = dayOfWeek === 0;
  const isMonday = dayOfWeek === 1;
  const isThursday = dayOfWeek === 4;

  // Game days with more frequent updates
  if (isSunday || isMonday || isThursday) {
    // During game hours (12pm-11pm ET), use 1 hour threshold
    if (hour >= 12 && hour <= 23) {
      return 1;
    }
    // Other times on game days, use 3 hour threshold
    return 3;
  }

  // Non-game days during season: 6 hour threshold
  return 6;
}

function triggerBackgroundSync(leagueId: string, requestOrigin: string) {
  // Trigger sync via API endpoint instead of direct import
  // This ensures the sync runs in a serverless function context, not in middleware
  // Use request origin to construct URL (works in all environments)
  const triggerUrl = `${requestOrigin}/api/sync/trigger?leagueId=${leagueId}`;

  console.log(`[Middleware] Triggering background sync for league ${leagueId}`);

  // Fire-and-forget fetch - don't await or block middleware
  fetch(triggerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).catch(error => {
    // Silent fail - don't block the request
    console.error(`[Middleware] Failed to trigger background sync for league ${leagueId}:`, error);
  });
}

export const config = {
  matcher: [
    '/roster',
    '/player-scoring',
  ],
};