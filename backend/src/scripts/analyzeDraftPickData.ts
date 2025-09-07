#!/usr/bin/env npx ts-node

/**
 * Analyze Draft Pick Data Quality
 * 
 * This script analyzes the current state of draft pick data to understand:
 * 1. How many draft picks exist for each season
 * 2. How many have valid playerSelectedId vs null
 * 3. How many draft selections exist for comparison
 * 4. Which seasons need data cleanup
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeDraftPickData() {
  console.log('🔍 Analyzing Draft Pick Data Quality\n');
  
  try {
    // Get overall stats
    console.log('📊 Overall Statistics:');
    console.log('=====================');
    
    const totalDraftPicks = await prisma.draftPick.count();
    const validDraftPicks = await prisma.draftPick.count({
      where: { playerSelectedId: { not: null } }
    });
    const invalidDraftPicks = await prisma.draftPick.count({
      where: { playerSelectedId: null }
    });
    
    console.log(`Total Draft Picks: ${totalDraftPicks}`);
    console.log(`Valid (with player): ${validDraftPicks}`);
    console.log(`Invalid (no player): ${invalidDraftPicks}`);
    console.log(`Validity Rate: ${((validDraftPicks / totalDraftPicks) * 100).toFixed(1)}%\n`);
    
    // Breakdown by season
    console.log('📈 Breakdown by Season:');
    console.log('========================');
    
    const seasonStats = await prisma.$queryRaw`
      SELECT 
        season,
        COUNT(*) as total_picks,
        COUNT(playerSelectedId) as valid_picks,
        COUNT(CASE WHEN playerSelectedId IS NULL THEN 1 END) as invalid_picks
      FROM draft_picks 
      GROUP BY season 
      ORDER BY season
    ` as any[];
    
    for (const stat of seasonStats) {
      const totalPicks = Number(stat.total_picks);
      const validPicks = Number(stat.valid_picks);
      const invalidPicks = Number(stat.invalid_picks);
      const validityRate = ((validPicks / totalPicks) * 100).toFixed(1);
      console.log(`${stat.season}: ${totalPicks} total, ${validPicks} valid, ${invalidPicks} invalid (${validityRate}% valid)`);
    }
    
    // Check draft selections for comparison
    console.log('\n🏈 Draft Selections Comparison:');
    console.log('===============================');
    
    const draftSelectionStats = await prisma.$queryRaw`
      SELECT 
        d.season,
        COUNT(ds.id) as total_selections,
        MAX(ds.pickNumber) as max_pick_number
      FROM draft_selections ds
      JOIN drafts d ON ds.draftId = d.id
      GROUP BY d.season
      ORDER BY d.season
    ` as any[];
    
    for (const stat of draftSelectionStats) {
      console.log(`${stat.season}: ${stat.total_selections} selections made (max pick #${stat.max_pick_number})`);
    }
    
    // Find problematic seasons (2021-2025 should all be complete)
    console.log('\n⚠️  Problematic Seasons (2021-2025):');
    console.log('=====================================');
    
    const problematicSeasons = seasonStats.filter(s => 
      parseInt(s.season) >= 2021 && 
      parseInt(s.season) <= 2025 && 
      Number(s.invalid_picks) > 0
    );
    
    if (problematicSeasons.length === 0) {
      console.log('✅ No problematic seasons found - all 2021-2025 picks have player selections!');
    } else {
      for (const season of problematicSeasons) {
        console.log(`❌ ${season.season}: ${Number(season.invalid_picks)} draft picks missing player selections`);
      }
    }
    
    // Sample some invalid records to understand the pattern
    console.log('\n🔍 Sample Invalid Draft Picks:');
    console.log('===============================');
    
    const sampleInvalid = await prisma.draftPick.findMany({
      where: { 
        playerSelectedId: null,
        season: { in: ['2021', '2022', '2023', '2024', '2025'] }
      },
      include: {
        originalOwner: { select: { displayName: true, username: true } },
        currentOwner: { select: { displayName: true, username: true } },
        league: { select: { name: true } }
      },
      take: 5,
      orderBy: [{ season: 'desc' }, { round: 'asc' }]
    });
    
    for (const pick of sampleInvalid) {
      console.log(`${pick.season} Round ${pick.round} - Original: ${pick.originalOwner?.displayName || pick.originalOwner?.username} | Current: ${pick.currentOwner?.displayName || pick.currentOwner?.username}`);
    }
    
    console.log('\n✅ Analysis complete!');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the analysis
analyzeDraftPickData().catch(console.error);