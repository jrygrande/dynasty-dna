import { getDb } from '@/db/index';
import { nflState } from '@/db/schema';
import { desc } from 'drizzle-orm';

export async function getCurrentSeason(): Promise<string> {
  const db = await getDb();

  try {
    // Try to get from NFL state table
    const [stateRow] = await db
      .select()
      .from(nflState)
      .orderBy(desc(nflState.fetchedAt))
      .limit(1);

    if (stateRow?.season) {
      return stateRow.season;
    }
  } catch (error) {
    console.warn('Could not fetch current season from nflState, falling back to current year');
  }

  // Fallback to current year
  const currentYear = new Date().getFullYear();
  return String(currentYear);
}

export async function getCurrentWeek(): Promise<number> {
  const db = await getDb();

  try {
    const [stateRow] = await db
      .select()
      .from(nflState)
      .orderBy(desc(nflState.fetchedAt))
      .limit(1);

    if (stateRow?.week) {
      return stateRow.week;
    }
  } catch (error) {
    console.warn('Could not fetch current week from nflState, falling back to week 1');
  }

  // Fallback to week 1
  return 1;
}