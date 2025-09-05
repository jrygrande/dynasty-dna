#!/usr/bin/env npx ts-node

/**
 * Script to resync all draft picks with their selection information
 * 
 * This script runs the resyncDraftPicks method from DataSyncService
 * to update all existing draft_picks with their pickNumber and playerSelectedId.
 */

import { DataSyncService } from '../services/dataSyncService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resyncDraftPicks() {
  console.log('🚀 Starting draft picks resync script...\n');
  
  try {
    const dataSyncService = new DataSyncService();
    
    // Run the resync
    const result = await dataSyncService.resyncDraftPicks();
    
    console.log('\n📈 Resync Summary:');
    console.log(`   ✅ Updated: ${result.updated} draft picks`);
    console.log(`   ⚠️  Skipped: ${result.skipped} draft picks`);
    
    // Show verification stats
    const totalDraftPicks = await prisma.draftPick.count();
    const picksWithNumbers = await prisma.draftPick.count({
      where: { pickNumber: { not: null } }
    });
    const picksWithoutNumbers = totalDraftPicks - picksWithNumbers;
    
    console.log('\n🔍 Final Status:');
    console.log(`   📊 Total draft picks: ${totalDraftPicks}`);
    console.log(`   ✅ With pick numbers: ${picksWithNumbers}`);
    console.log(`   ⚠️  Still missing: ${picksWithoutNumbers}`);
    
    if (picksWithoutNumbers > 0) {
      console.log('\nℹ️  Note: Remaining picks without numbers are likely future picks that haven\'t been drafted yet.');
    }
    
  } catch (error) {
    console.error('💥 Resync failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script if executed directly
if (require.main === module) {
  resyncDraftPicks()
    .then(() => {
      console.log('\n🎉 Draft picks resync completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
}

export { resyncDraftPicks };