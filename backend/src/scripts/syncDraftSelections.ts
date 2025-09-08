import { PrismaClient } from '@prisma/client';
import { sleeperClient } from '../services/sleeperClient';

const prisma = new PrismaClient();

interface DraftSelectionStats {
  draftId: string;
  season: string;
  leagueName: string;
  totalPicks: number;
  successfulPicks: number;
  createdPlayers: number;
  errors: string[];
}

async function syncAllDraftSelections(): Promise<void> {
  console.log('🎯 Starting comprehensive draft selections sync...');
  
  const stats: DraftSelectionStats[] = [];
  
  try {
    // Get all drafts in database
    const drafts = await prisma.draft.findMany({
      include: {
        league: true
      },
      orderBy: { season: 'asc' }
    });
    
    console.log(`📋 Found ${drafts.length} drafts to sync`);
    
    for (const draft of drafts) {
      console.log(`\n🔄 Syncing ${draft.league.name} (${draft.season})`);
      
      const draftStats: DraftSelectionStats = {
        draftId: draft.sleeperDraftId,
        season: draft.season,
        leagueName: draft.league.name,
        totalPicks: 0,
        successfulPicks: 0,
        createdPlayers: 0,
        errors: []
      };
      
      try {
        // Clear existing selections for this draft
        const deleted = await prisma.draftSelection.deleteMany({
          where: { draftId: draft.id }
        });
        console.log(`  🧹 Cleared ${deleted.count} existing selections`);
        
        // Fetch all draft picks from Sleeper API
        const picks = await sleeperClient.getDraftPicks(draft.sleeperDraftId);
        draftStats.totalPicks = picks.length;
        console.log(`  📊 Processing ${picks.length} picks from Sleeper API`);
        
        // Process each pick
        for (const pick of picks) {
          try {
            if (!pick.player_id) {
              console.log(`    ⚠️  Skipping pick ${pick.pick_no}: no player selected`);
              continue;
            }
            
            // Find or create player
            let player = await prisma.player.findFirst({
              where: { sleeperId: pick.player_id }
            });
            
            if (!player) {
              // Create player from metadata
              const metadata = pick.metadata || {};
              console.log(`    📝 Creating player: ${metadata.first_name} ${metadata.last_name} (${pick.player_id})`);
              
              player = await prisma.player.create({
                data: {
                  sleeperId: pick.player_id,
                  firstName: metadata.first_name || '',
                  lastName: metadata.last_name || '',
                  fullName: (metadata.first_name && metadata.last_name) 
                    ? `${metadata.first_name} ${metadata.last_name}`
                    : metadata.last_name || `Player ${pick.player_id}`,
                  position: metadata.position || 'Unknown',
                  team: metadata.team || null,
                  status: metadata.status || 'Unknown',
                  number: metadata.number || null,
                  yearsExp: metadata.years_exp ? parseInt(metadata.years_exp) : null
                }
              });
              draftStats.createdPlayers++;
            }
            
            // Create draft selection
            await prisma.draftSelection.create({
              data: {
                draftId: draft.id,
                pickNumber: pick.pick_no,
                round: pick.round,
                draftSlot: pick.draft_slot,
                playerId: player.id,
                rosterId: pick.roster_id,
                pickedBy: pick.picked_by || '',
                isKeeper: pick.is_keeper || false,
                metadata: pick.metadata ? JSON.stringify(pick.metadata) : null
              }
            });
            
            draftStats.successfulPicks++;
            console.log(`    ✅ Pick ${pick.pick_no}: ${player.fullName} (R${pick.round})`);
            
          } catch (pickError) {
            const errorMsg = `Pick ${pick.pick_no}: ${pickError instanceof Error ? pickError.message : String(pickError)}`;
            console.error(`    ❌ ${errorMsg}`);
            draftStats.errors.push(errorMsg);
          }
        }
        
      } catch (draftError) {
        const errorMsg = `Draft ${draft.season}: ${draftError instanceof Error ? draftError.message : String(draftError)}`;
        console.error(`  ❌ ${errorMsg}`);
        draftStats.errors.push(errorMsg);
      }
      
      stats.push(draftStats);
      console.log(`  📋 ${draft.season} Summary: ${draftStats.successfulPicks}/${draftStats.totalPicks} picks, ${draftStats.createdPlayers} players created, ${draftStats.errors.length} errors`);
    }
    
    // Final summary
    console.log('\n🎯 FINAL SYNC SUMMARY');
    console.log('====================');
    
    const totalPicks = stats.reduce((sum, s) => sum + s.totalPicks, 0);
    const totalSuccessful = stats.reduce((sum, s) => sum + s.successfulPicks, 0);
    const totalCreated = stats.reduce((sum, s) => sum + s.createdPlayers, 0);
    const totalErrors = stats.reduce((sum, s) => sum + s.errors.length, 0);
    
    console.log(`📊 Total Picks: ${totalPicks}`);
    console.log(`✅ Successful: ${totalSuccessful}`);
    console.log(`📝 Players Created: ${totalCreated}`);
    console.log(`❌ Errors: ${totalErrors}`);
    
    stats.forEach(s => {
      console.log(`  ${s.season}: ${s.successfulPicks}/${s.totalPicks} picks`);
    });
    
    if (totalErrors > 0) {
      console.log('\n❌ ERRORS ENCOUNTERED:');
      stats.forEach(s => {
        if (s.errors.length > 0) {
          console.log(`  ${s.season}:`);
          s.errors.forEach(e => console.log(`    - ${e}`));
        }
      });
    }
    
    // Verify database state
    console.log('\n🔍 DATABASE VERIFICATION');
    const finalCount = await prisma.draftSelection.count();
    console.log(`Total selections in database: ${finalCount}`);
    
    const selectionsByDraft = await prisma.draftSelection.groupBy({
      by: ['draftId'],
      _count: { draftId: true }
    });
    
    for (const group of selectionsByDraft) {
      const draft = await prisma.draft.findUnique({
        where: { id: group.draftId },
        select: { season: true, league: { select: { name: true } } }
      });
      console.log(`  ${draft?.league.name} (${draft?.season}): ${group._count.draftId} selections`);
    }
    
  } catch (error) {
    console.error('❌ Fatal error during sync:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
if (require.main === module) {
  syncAllDraftSelections()
    .then(() => {
      console.log('\n✨ Draft selections sync completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Draft selections sync failed:', error);
      process.exit(1);
    });
}

export { syncAllDraftSelections };