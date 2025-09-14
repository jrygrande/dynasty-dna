import 'dotenv/config';
import { getDb } from '@/db/index';
import { getLeagueFamily } from '@/services/assets';
import { rosters, transactions, matchups, drafts, draftPicks, tradedPicks, players } from '@/db/schema';
import { and, count, eq, inArray, sql } from 'drizzle-orm';

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) {
    console.error('Usage: tsx scripts/summary.ts <leagueId>');
    process.exit(1);
  }
  const db = await getDb();
  const family = await getLeagueFamily(leagueId);
  console.log('League family:', family);

  const res: any[] = [];
  for (const lid of family) {
    const [rCount] = await db.select({ c: count() }).from(rosters).where(eq(rosters.leagueId, lid));
    const [tCount] = await db.select({ c: count() }).from(transactions).where(eq(transactions.leagueId, lid));
    const [mCount] = await db.select({ c: count() }).from(matchups).where(eq(matchups.leagueId, lid));
    const [dCount] = await db.select({ c: count() }).from(drafts).where(eq(drafts.leagueId, lid));
    const [dpCount] = await db
      .select({ c: count() })
      .from(draftPicks)
      .where(inArray(draftPicks.draftId, (await db.select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, lid))).map((x) => x.id)));
    const [tpCount] = await db.select({ c: count() }).from(tradedPicks).where(eq(tradedPicks.leagueId, lid));
    res.push({ leagueId: lid, rosters: rCount.c, transactions: tCount.c, matchups: mCount.c, drafts: dCount.c, draftPicks: dpCount.c, tradedPicks: tpCount.c });
  }
  console.table(res);
}

main().catch((e) => {
  console.error('Summary failed:', e);
  process.exit(1);
});

