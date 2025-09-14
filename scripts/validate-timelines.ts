import 'dotenv/config';
import { getLeagueFamily } from '@/services/assets';
import { topPlayersByEventCount, topPicksByEventCount, getPlayerTimeline, getPickTimeline } from '@/repositories/assetEvents';

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) {
    console.error('Usage: tsx scripts/validate-timelines.ts <leagueId>');
    process.exit(1);
  }
  const family = await getLeagueFamily(leagueId);
  console.log('League family:', family);
  const topPlayers = await topPlayersByEventCount(family, 3);
  const topPicks = await topPicksByEventCount(family, 3);
  console.log('Top players by events:', topPlayers);
  console.log('Top picks by events:', topPicks);
  if (topPlayers[0]?.playerId) {
    const tl = await getPlayerTimeline(family, topPlayers[0].playerId!);
    console.log('Sample player timeline for', topPlayers[0].playerId, 'count=', tl.length);
    console.log(tl.slice(0, Math.min(5, tl.length)));
  }
  if (topPicks[0]) {
    const { pickSeason, pickRound, pickOriginalRosterId } = topPicks[0];
    const tl = await getPickTimeline(family, String(pickSeason), Number(pickRound), Number(pickOriginalRosterId));
    console.log('Sample pick timeline for', { pickSeason, pickRound, pickOriginalRosterId }, 'count=', tl.length);
    console.log(tl.slice(0, Math.min(5, tl.length)));
  }
}

main().catch((e) => {
  console.error('Validation failed:', e);
  process.exit(1);
});

