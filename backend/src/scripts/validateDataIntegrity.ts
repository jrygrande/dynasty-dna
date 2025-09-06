import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ValidationResult {
  category: string;
  passed: boolean;
  message: string;
  details?: string[];
  count?: number;
}

/**
 * Comprehensive data integrity validation for Dynasty DNA
 * 
 * This script validates critical data integrity constraints before 
 * proceeding with transaction chain visualizations:
 * 
 * 1. Ownership Chain Completeness - Every asset traceable from origin
 * 2. Draft Pick Integrity - Picks used correctly and chronologically  
 * 3. Transaction Temporal Consistency - All transactions properly ordered
 * 4. Single Owner Constraint - No simultaneous ownership conflicts
 * 5. Historical State Validation - Final states match transaction history
 */
async function validateDataIntegrity(): Promise<ValidationResult[]> {
  console.log('🔍 Starting comprehensive data integrity validation...\n');
  
  const results: ValidationResult[] = [];
  
  try {
    // 1. Validate Ownership Chain Completeness
    console.log('📊 1. Validating Ownership Chain Completeness...');
    const ownershipResults = await validateOwnershipChains();
    results.push(...ownershipResults);
    
    // 2. Validate Draft Pick Integrity  
    console.log('\n📊 2. Validating Draft Pick Integrity...');
    const draftResults = await validateDraftIntegrity();
    results.push(...draftResults);
    
    // 3. Validate Transaction Temporal Consistency
    console.log('\n📊 3. Validating Transaction Temporal Consistency...');
    const temporalResults = await validateTemporalConsistency();
    results.push(...temporalResults);
    
    // 4. Validate Single Owner Constraint
    console.log('\n📊 4. Validating Single Owner Constraint...');
    const ownerConstraintResults = await validateSingleOwnerConstraint();
    results.push(...ownerConstraintResults);
    
    // 5. Validate Historical State Consistency
    console.log('\n📊 5. Validating Historical State Consistency...');
    const historicalResults = await validateHistoricalStates();
    results.push(...historicalResults);
    
    // Summary Report
    console.log('\n' + '='.repeat(80));
    console.log('📋 VALIDATION SUMMARY REPORT');
    console.log('='.repeat(80));
    
    const totalChecks = results.length;
    const passedChecks = results.filter(r => r.passed).length;
    const failedChecks = totalChecks - passedChecks;
    
    console.log(`\n📊 Overall Results: ${passedChecks}/${totalChecks} checks passed`);
    console.log(`✅ Passed: ${passedChecks}`);
    console.log(`❌ Failed: ${failedChecks}\n`);
    
    // Group results by category
    const categories = [...new Set(results.map(r => r.category))];
    
    for (const category of categories) {
      const categoryResults = results.filter(r => r.category === category);
      const categoryPassed = categoryResults.filter(r => r.passed).length;
      const categoryTotal = categoryResults.length;
      
      const status = categoryPassed === categoryTotal ? '✅' : '❌';
      console.log(`${status} ${category}: ${categoryPassed}/${categoryTotal} checks passed`);
      
      // Show failed checks
      const failed = categoryResults.filter(r => !r.passed);
      failed.forEach(f => {
        console.log(`   ❌ ${f.message}`);
        if (f.details && f.details.length > 0) {
          f.details.slice(0, 3).forEach(detail => console.log(`      - ${detail}`));
          if (f.details.length > 3) {
            console.log(`      - ... and ${f.details.length - 3} more`);
          }
        }
      });
    }
    
    console.log('\n' + '='.repeat(80));
    
    if (failedChecks === 0) {
      console.log('🎉 ALL VALIDATION CHECKS PASSED! Data integrity confirmed.');
      console.log('✅ Safe to proceed with frontend visualizations.');
    } else {
      console.log('⚠️  VALIDATION FAILURES DETECTED! Address issues before proceeding.');
      console.log('❌ Do not proceed with visualizations until all checks pass.');
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Validation failed with error:', error);
    throw error;
  }
}

/**
 * Validate that all assets have complete ownership chains from creation to current owner
 */
async function validateOwnershipChains(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  // Check for orphaned draft picks (no clear origin)
  const orphanedPicks = await prisma.$queryRaw`
    SELECT dp.id, dp.season, dp.round, dp.draftSlot
    FROM draft_picks dp
    WHERE dp.originalOwnerId IS NULL OR dp.currentOwnerId IS NULL
  `;
  
  results.push({
    category: 'Ownership Chain Completeness',
    passed: (orphanedPicks as any[]).length === 0,
    message: `Draft picks with missing ownership data`,
    count: (orphanedPicks as any[]).length,
    details: (orphanedPicks as any[]).map(p => `${p.season} R${p.round}.${p.draftSlot} (ID: ${p.id})`)
  });
  
  // Check for players without clear acquisition path
  const orphanedPlayers = await prisma.$queryRaw`
    SELECT p.id, p.fullName
    FROM players p
    WHERE p.id NOT IN (
      SELECT DISTINCT ti.playerId 
      FROM transaction_items ti 
      WHERE ti.playerId IS NOT NULL AND ti.type = 'add'
    )
    AND p.id IN (
      SELECT DISTINCT dp.playerSelectedId 
      FROM draft_picks dp 
      WHERE dp.playerSelectedId IS NOT NULL
    )
    LIMIT 10
  `;
  
  results.push({
    category: 'Ownership Chain Completeness',
    passed: (orphanedPlayers as any[]).length === 0,
    message: `Players without acquisition transactions`,
    count: (orphanedPlayers as any[]).length,
    details: (orphanedPlayers as any[]).map(p => `${p.fullName} (ID: ${p.id})`)
  });
  
  // Check for incomplete trades (missing both sides)
  const incompleteTrades = await prisma.$queryRaw`
    SELECT t.id, t.sleeperTransactionId, t.type
    FROM transactions t
    WHERE t.type = 'trade'
    AND (
      SELECT COUNT(DISTINCT ti.managerId) 
      FROM transaction_items ti 
      WHERE ti.transactionId = t.id
    ) < 2
    LIMIT 10
  `;
  
  results.push({
    category: 'Ownership Chain Completeness', 
    passed: (incompleteTrades as any[]).length === 0,
    message: `Incomplete trades (missing one side)`,
    count: (incompleteTrades as any[]).length,
    details: (incompleteTrades as any[]).map(t => `Transaction ${t.sleeperTransactionId} (ID: ${t.id})`)
  });
  
  return results;
}

/**
 * Validate draft pick integrity and chronological consistency
 */
async function validateDraftIntegrity(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  // Check for duplicate player selections
  const duplicateSelections = await prisma.$queryRaw`
    SELECT dp1.playerSelectedId, p.fullName, COUNT(*) as selection_count
    FROM draft_picks dp1
    JOIN players p ON dp1.playerSelectedId = p.id
    WHERE dp1.playerSelectedId IS NOT NULL
    GROUP BY dp1.playerSelectedId, p.fullName
    HAVING COUNT(*) > 1
    LIMIT 10
  `;
  
  results.push({
    category: 'Draft Pick Integrity',
    passed: (duplicateSelections as any[]).length === 0,
    message: `Players selected multiple times`,
    count: (duplicateSelections as any[]).length,
    details: (duplicateSelections as any[]).map(d => `${d.fullName} selected ${d.selection_count} times`)
  });
  
  // Check for missing draft slots in completed seasons
  const missingSlots = await prisma.$queryRaw`
    WITH expected_slots AS (
      SELECT season, round, slot
      FROM (SELECT DISTINCT season FROM draft_picks WHERE season <= '2025') seasons
      CROSS JOIN (SELECT 1 as round UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) rounds  
      CROSS JOIN (SELECT 1 as slot UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION 
                  SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION 
                  SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION SELECT 12) slots
      WHERE seasons.season != '2021'  -- Skip startup draft
    )
    SELECT es.season, es.round, es.slot
    FROM expected_slots es
    LEFT JOIN draft_picks dp ON es.season = dp.season AND es.round = dp.round AND es.slot = dp.draftSlot
    WHERE dp.id IS NULL
    AND es.season <= '2025'
    LIMIT 10
  `;
  
  results.push({
    category: 'Draft Pick Integrity',
    passed: (missingSlots as any[]).length === 0,
    message: `Missing draft slots in completed seasons`,
    count: (missingSlots as any[]).length,
    details: (missingSlots as any[]).map(m => `${m.season} R${m.round}.${m.slot}`)
  });
  
  // Check for draft picks without selections in completed drafts
  const unselectedPicks = await prisma.$queryRaw`
    SELECT season, round, COUNT(*) as unselected_count
    FROM draft_picks 
    WHERE season <= '2025' 
    AND season != '2021'
    AND playerSelectedId IS NULL
    GROUP BY season, round
    HAVING COUNT(*) > 0
  `;
  
  results.push({
    category: 'Draft Pick Integrity',
    passed: (unselectedPicks as any[]).length === 0,
    message: `Draft picks without player selections in completed seasons`,
    count: (unselectedPicks as any[]).length,
    details: (unselectedPicks as any[]).map(u => `${u.season} R${u.round}: ${u.unselected_count} unselected`)
  });
  
  return results;
}

/**
 * Validate transaction temporal consistency and chronological order
 */
async function validateTemporalConsistency(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  // Check for transactions without timestamps
  const noTimestamp = await prisma.transaction.count({
    where: { timestamp: null }
  });
  
  results.push({
    category: 'Transaction Temporal Consistency',
    passed: noTimestamp === 0,
    message: `Transactions without timestamps`,
    count: noTimestamp
  });
  
  // Check for transactions without involved parties
  const noParties = await prisma.$queryRaw`
    SELECT t.id, t.sleeperTransactionId, t.type
    FROM transactions t
    WHERE (
      SELECT COUNT(DISTINCT ti.managerId) 
      FROM transaction_items ti 
      WHERE ti.transactionId = t.id
    ) = 0
    LIMIT 10
  `;
  
  results.push({
    category: 'Transaction Temporal Consistency',
    passed: (noParties as any[]).length === 0,
    message: `Transactions without involved parties`,
    count: (noParties as any[]).length,
    details: (noParties as any[]).map(t => `${t.type} ${t.sleeperTransactionId} (ID: ${t.id})`)
  });
  
  // Check for future-dated transactions in historical data
  const currentTimestamp = BigInt(Date.now());
  const futureDated = await prisma.transaction.count({
    where: { 
      timestamp: { gt: currentTimestamp }
    }
  });
  
  results.push({
    category: 'Transaction Temporal Consistency',
    passed: futureDated === 0,
    message: `Future-dated transactions`,
    count: futureDated
  });
  
  return results;
}

/**
 * Validate single owner constraint - no asset owned by multiple parties simultaneously
 */
async function validateSingleOwnerConstraint(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  // This is a complex validation that would require temporal analysis
  // For now, we'll check simpler constraints
  
  // Check for draft picks with inconsistent ownership
  const inconsistentPicks = await prisma.$queryRaw`
    SELECT dp.id, dp.season, dp.round, dp.draftSlot,
           dp.originalOwnerId, dp.currentOwnerId, dp.previousOwnerId
    FROM draft_picks dp
    WHERE dp.traded = false 
    AND dp.originalOwnerId != dp.currentOwnerId
    LIMIT 10
  `;
  
  results.push({
    category: 'Single Owner Constraint',
    passed: (inconsistentPicks as any[]).length === 0,
    message: `Draft picks marked as untraded but have different owners`,
    count: (inconsistentPicks as any[]).length,
    details: (inconsistentPicks as any[]).map(p => 
      `${p.season} R${p.round}.${p.draftSlot}: original=${p.originalOwnerId} current=${p.currentOwnerId}`)
  });
  
  // Check for picks marked as traded but same owner
  const wronglyMarkedTraded = await prisma.$queryRaw`
    SELECT dp.id, dp.season, dp.round, dp.draftSlot
    FROM draft_picks dp  
    WHERE dp.traded = true
    AND dp.originalOwnerId = dp.currentOwnerId
    AND dp.previousOwnerId IS NULL
    LIMIT 10
  `;
  
  results.push({
    category: 'Single Owner Constraint',
    passed: (wronglyMarkedTraded as any[]).length === 0,
    message: `Draft picks marked as traded but have same original/current owner`,
    count: (wronglyMarkedTraded as any[]).length,
    details: (wronglyMarkedTraded as any[]).map(p => `${p.season} R${p.round}.${p.draftSlot}`)
  });
  
  return results;
}

/**
 * Validate that historical roster states are consistent with transaction history
 */
async function validateHistoricalStates(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  // Check that all managers exist and are properly linked
  const orphanedTransactionItems = await prisma.$queryRaw`
    SELECT ti.id, ti.transactionId, ti.managerId
    FROM transaction_items ti
    LEFT JOIN managers m ON ti.managerId = m.id
    WHERE m.id IS NULL
    LIMIT 10
  `;
  
  results.push({
    category: 'Historical State Consistency',
    passed: (orphanedTransactionItems as any[]).length === 0,
    message: `Transaction items referencing non-existent managers`,
    count: (orphanedTransactionItems as any[]).length,
    details: (orphanedTransactionItems as any[]).map(t => `Item ${t.id} -> Manager ${t.managerId}`)
  });
  
  // Check for transaction items without assets
  const emptyTransactionItems = await prisma.$queryRaw`
    SELECT ti.id, ti.transactionId, ti.type
    FROM transaction_items ti
    WHERE ti.playerId IS NULL 
    AND ti.draftPickId IS NULL
    LIMIT 10
  `;
  
  results.push({
    category: 'Historical State Consistency',
    passed: (emptyTransactionItems as any[]).length === 0,
    message: `Transaction items without any assets`,
    count: (emptyTransactionItems as any[]).length,
    details: (emptyTransactionItems as any[]).map(t => `Item ${t.id} (${t.type}) in transaction ${t.transactionId}`)
  });
  
  // Check trade balance - every trade should have balanced adds/drops
  const unbalancedTrades = await prisma.$queryRaw`
    SELECT t.id, t.sleeperTransactionId,
           SUM(CASE WHEN ti.type = 'add' THEN 1 ELSE 0 END) as adds,
           SUM(CASE WHEN ti.type = 'drop' THEN 1 ELSE 0 END) as drops
    FROM transactions t
    JOIN transaction_items ti ON t.id = ti.transactionId
    WHERE t.type = 'trade'
    GROUP BY t.id, t.sleeperTransactionId
    HAVING SUM(CASE WHEN ti.type = 'add' THEN 1 ELSE 0 END) != 
           SUM(CASE WHEN ti.type = 'drop' THEN 1 ELSE 0 END)
    LIMIT 10
  `;
  
  results.push({
    category: 'Historical State Consistency',
    passed: (unbalancedTrades as any[]).length === 0,
    message: `Unbalanced trades (adds != drops)`,
    count: (unbalancedTrades as any[]).length,
    details: (unbalancedTrades as any[]).map(t => `${t.sleeperTransactionId}: ${t.adds} adds, ${t.drops} drops`)
  });
  
  return results;
}

/**
 * Main execution
 */
async function main() {
  try {
    const results = await validateDataIntegrity();
    
    // Exit with appropriate code
    const allPassed = results.every(r => r.passed);
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    console.error('Validation script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { validateDataIntegrity, ValidationResult };