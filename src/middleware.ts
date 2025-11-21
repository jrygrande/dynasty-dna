import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Allow skipping sync for testing or manual override
  if (request.cookies.has('DYNASTY_DNA_SKIP_SYNC')) {
    console.log('[Middleware] Skipping sync due to DYNASTY_DNA_SKIP_SYNC cookie');
    return NextResponse.next();
  }

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
  // Stale if never synced or last sync > 1 hour ago
  const STALENESS_THRESHOLD_HOURS = 1;
  try {
    // Import directly to avoid middleware fetch issues
    const { isLeagueDataStale } = await import('@/repositories/leagues');
    return await isLeagueDataStale(leagueId, STALENESS_THRESHOLD_HOURS);
  } catch (error) {
    console.error('Error checking staleness:', error);
    // Default to not stale on error to avoid sync loops
    return false;
  }
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