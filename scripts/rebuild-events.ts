#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { rebuildAssetEventsForLeagueFamily } from '../src/services/assets';

async function main() {
  const leagueId = process.argv[2];

  if (!leagueId) {
    console.error('Usage: npx tsx scripts/rebuild-events.ts <leagueId>');
    console.error('Example: npx tsx scripts/rebuild-events.ts 1191596293294166016');
    process.exit(1);
  }

  console.log(`Starting asset events rebuild for league family: ${leagueId}`);

  try {
    const result = await rebuildAssetEventsForLeagueFamily(leagueId);
    console.log('\n✅ Asset events rebuild completed successfully!');
    console.log('Result:', result);
  } catch (error) {
    console.error('\n❌ Asset events rebuild failed:');
    console.error(error);
    process.exit(1);
  }
}

main();