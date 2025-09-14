import 'dotenv/config';
import { syncLeagueFamily } from '@/services/sync';
import { rebuildAssetEventsForLeagueFamily } from '@/services/assets';

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) {
    console.error('Usage: tsx scripts/prewarm.ts <leagueId>');
    process.exit(1);
  }
  console.log('Prewarming for league family of', leagueId);
  const sync = await syncLeagueFamily(leagueId);
  console.log('Synced leagues:', sync.leagues);
  const rebuild = await rebuildAssetEventsForLeagueFamily(leagueId);
  console.log('Rebuilt asset events:', rebuild);
}

main().catch((e) => {
  console.error('Prewarm failed:', e);
  process.exit(1);
});

