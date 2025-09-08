import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateDraftPicksUniqueConstraint(): Promise<void> {
  console.log('🔄 Migrating draft picks to use new unique constraint...');
  
  try {
    console.log('📊 Analyzing current draft picks...');
    
    // First, identify and resolve any duplicates based on [leagueId, season, round, originalOwnerId]
    const duplicates = await prisma.$queryRaw<Array<{
      leagueId: string;
      season: string;
      round: number;
      originalOwnerId: string;
      count: number;
    }>>`
      SELECT 
        leagueId, 
        season, 
        round, 
        originalOwnerId, 
        COUNT(*) as count
      FROM draft_picks 
      WHERE originalOwnerId IS NOT NULL 
      GROUP BY leagueId, season, round, originalOwnerId 
      HAVING COUNT(*) > 1
    `;
    
    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} duplicate groups that need resolution...`);
      
      for (const duplicate of duplicates) {
        console.log(`🔍 Resolving duplicates for: ${duplicate.season} Round ${duplicate.round} - Owner ${duplicate.originalOwnerId}`);
        
        // Get all picks in this duplicate group
        const duplicatePicks = await prisma.draftPick.findMany({
          where: {
            leagueId: duplicate.leagueId,
            season: duplicate.season,
            round: duplicate.round,
            originalOwnerId: duplicate.originalOwnerId
          },
          orderBy: { createdAt: 'asc' } // Keep the oldest one
        });
        
        // Keep the first pick, delete the rest
        const [keepPick, ...deletePicks] = duplicatePicks;
        
        if (deletePicks.length > 0) {
          console.log(`    🗑️  Keeping pick ${keepPick.id}, deleting ${deletePicks.length} duplicates`);
          
          await prisma.draftPick.deleteMany({
            where: {
              id: {
                in: deletePicks.map(p => p.id)
              }
            }
          });
        }
      }
    } else {
      console.log('✅ No duplicates found for new constraint');
    }
    
    // Handle picks with NULL originalOwnerId
    const nullOwnerCount = await prisma.draftPick.count({
      where: { originalOwnerId: null }
    });
    
    if (nullOwnerCount > 0) {
      console.log(`⚠️  Found ${nullOwnerCount} picks with NULL originalOwnerId`);
      console.log('🗑️  Removing picks with NULL originalOwnerId (they will be recreated by sync)...');
      
      await prisma.draftPick.deleteMany({
        where: { originalOwnerId: null }
      });
    }
    
    // Now apply the schema change
    console.log('🔧 Applying schema changes...');
    
    try {
      // Drop the old unique constraint if it exists
      await prisma.$executeRaw`
        DROP INDEX IF EXISTS draft_picks_leagueId_season_round_pickInRound_key;
      `;
      
      // Create the new unique constraint
      await prisma.$executeRaw`
        CREATE UNIQUE INDEX draft_picks_leagueId_season_round_originalOwnerId_key 
        ON draft_picks(leagueId, season, round, originalOwnerId);
      `;
      
      console.log('✅ Successfully created new unique constraint');
      
    } catch (error) {
      console.error('❌ Error applying schema changes:', error);
      throw error;
    }
    
    // Verify the final result
    const finalCount = await prisma.draftPick.count();
    const finalDuplicates = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count
      FROM (
        SELECT leagueId, season, round, originalOwnerId, COUNT(*) as group_count
        FROM draft_picks 
        WHERE originalOwnerId IS NOT NULL
        GROUP BY leagueId, season, round, originalOwnerId 
        HAVING COUNT(*) > 1
      )
    `;
    
    console.log('\\n🎯 MIGRATION SUMMARY:');
    console.log(`📊 Total draft picks: ${finalCount}`);
    console.log(`🔄 Duplicate groups remaining: ${finalDuplicates[0]?.count || 0}`);
    
    if ((finalDuplicates[0]?.count || 0) === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Some duplicates may still exist');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  migrateDraftPicksUniqueConstraint()
    .then(() => {
      console.log('\\n✨ Draft picks unique constraint migration completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\\n💥 Migration failed:', error);
      process.exit(1);
    });
}

export { migrateDraftPicksUniqueConstraint };