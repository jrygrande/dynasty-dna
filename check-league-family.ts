#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getLeagueFamily } from './src/services/assets';

async function checkLeagueFamily() {
  console.log('=== Checking league family logic ===\n');

  // Test with one of the problematic leagues
  const rootLeagueId = '1051592789462589440';

  console.log(`Getting league family for: ${rootLeagueId}`);
  const family = await getLeagueFamily(rootLeagueId);

  console.log(`League family: ${family.length} leagues`);
  family.forEach((leagueId, i) => {
    console.log(`  ${i + 1}. ${leagueId}`);
  });

  // Check for duplicates in the family
  const uniqueLeagues = new Set(family);
  if (family.length !== uniqueLeagues.size) {
    console.log('\n❌ FOUND DUPLICATE LEAGUES IN FAMILY!');
    console.log('Original:', family);
    console.log('Unique:', Array.from(uniqueLeagues));
  } else {
    console.log('\n✅ No duplicate leagues in family');
  }

  // Now test if calling getLeagueFamily multiple times gives consistent results
  console.log('\n=== Testing consistency ===');
  const family2 = await getLeagueFamily(rootLeagueId);
  const family3 = await getLeagueFamily(rootLeagueId);

  if (JSON.stringify(family) === JSON.stringify(family2) && JSON.stringify(family2) === JSON.stringify(family3)) {
    console.log('✅ getLeagueFamily returns consistent results');
  } else {
    console.log('❌ getLeagueFamily returns inconsistent results!');
    console.log('Call 1:', family);
    console.log('Call 2:', family2);
    console.log('Call 3:', family3);
  }
}

checkLeagueFamily().catch(console.error);