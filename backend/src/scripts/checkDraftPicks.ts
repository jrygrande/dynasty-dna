import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDraftPicksStatus(): Promise<void> {
  console.log('🔍 Checking current draft picks status...');
  
  try {
    // Count picks by season
    const picksBySeason = await prisma.draftPick.groupBy({
      by: ['season'],
      _count: { season: true },
      orderBy: { season: 'asc' }
    });
    
    console.log('\n📊 DRAFT PICKS BY SEASON:');
    picksBySeason.forEach(group => {
      console.log(`  ${group.season}: ${group._count.season} picks`);
    });
    
    const totalPicks = await prisma.draftPick.count();
    console.log(`\n  Total: ${totalPicks} picks`);
    
    // Count selections by season for comparison using raw query
    
    console.log('\n📋 DRAFT SELECTIONS BY SEASON:');
    const selectionsSummary = await prisma.$queryRaw`
      SELECT d.season, COUNT(ds.id) as selections
      FROM draft_selections ds
      JOIN drafts d ON ds.draftId = d.id
      GROUP BY d.season
      ORDER BY d.season
    ` as Array<{ season: string; selections: bigint }>;
    
    selectionsSummary.forEach(row => {
      console.log(`  ${row.season}: ${Number(row.selections)} selections`);
    });
    
    const totalSelections = await prisma.draftSelection.count();
    console.log(`\n  Total: ${totalSelections} selections`);
    
    // What we need
    console.log('\n🎯 WHAT WE NEED:');
    console.log('  2021: 324 picks (startup draft - 27 rounds × 12 teams)');
    console.log('  2022: 48 picks (4 rounds × 12 teams)');
    console.log('  2023: 48 picks (4 rounds × 12 teams)');  
    console.log('  2024: 48 picks (4 rounds × 12 teams)');
    console.log('  2025: 48 picks (4 rounds × 12 teams)');
    console.log('  2026: 48 picks (future - 4 rounds × 12 teams)');
    console.log('  2027: 48 picks (future - 4 rounds × 12 teams)');
    console.log('  2028: 48 picks (future - 4 rounds × 12 teams)');
    console.log('  ----');
    console.log('  Total needed: 660 picks');
    
  } catch (error) {
    console.error('❌ Error checking draft picks:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check
if (require.main === module) {
  checkDraftPicksStatus()
    .then(() => {
      console.log('\n✨ Draft picks check completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Draft picks check failed:', error);
      process.exit(1);
    });
}

export { checkDraftPicksStatus };