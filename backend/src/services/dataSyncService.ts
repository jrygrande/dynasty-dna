import { PrismaClient } from '@prisma/client';
import { sleeperClient, type SleeperTransaction } from './sleeperClient';

const prisma = new PrismaClient();

export class DataSyncError extends Error {
  constructor(
    message: string,
    public operation?: string,
    public leagueId?: string
  ) {
    super(message);
    this.name = 'DataSyncError';
  }
}

export class DataSyncService {
  /**
   * Sync all league data including player scoring
   */
  async syncLeague(leagueId: string): Promise<{ 
    success: boolean; 
    synced: string[]; 
    errors: string[] 
  }> {
    const synced: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Sync league basic information
      try {
        await this.syncLeagueInfo(leagueId);
        synced.push('League information');
      } catch (error) {
        errors.push(`League info: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 2. Sync users/managers
      try {
        await this.syncLeagueUsers(leagueId);
        synced.push('League users');
      } catch (error) {
        errors.push(`Users: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 3. Sync players
      try {
        await this.syncPlayers();
        synced.push('Player data');
      } catch (error) {
        errors.push(`Players: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 4. Sync rosters
      try {
        await this.syncLeagueRosters(leagueId);
        synced.push('League rosters');
      } catch (error) {
        errors.push(`Rosters: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 5. Sync transactions
      try {
        await this.syncLeagueTransactions(leagueId);
        synced.push('League transactions');
      } catch (error) {
        errors.push(`Transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 6. Sync draft picks
      try {
        await this.syncLeagueDraftPicks(leagueId);
        synced.push('Draft picks');
      } catch (error) {
        errors.push(`Draft picks: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 7. Sync drafts and create draft transactions
      try {
        await this.syncLeagueDrafts(leagueId);
        synced.push('Drafts and draft transactions');
      } catch (error) {
        errors.push(`Drafts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 8. Sync player weekly scoring data
      try {
        await this.syncPlayerWeeklyScores(leagueId);
        synced.push('Player weekly scores');
      } catch (error) {
        errors.push(`Player scores: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 9. Sync NFL state data
      try {
        await this.syncNFLState();
        synced.push('NFL state data');
      } catch (error) {
        errors.push(`NFL state: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // 10. Sync matchup results
      try {
        await this.syncMatchupResults(leagueId);
        synced.push('Matchup results');
      } catch (error) {
        errors.push(`Matchup results: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      return {
        success: errors.length === 0,
        synced,
        errors
      };

    } catch (error) {
      throw new DataSyncError(
        `Failed to sync league: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'syncLeague',
        leagueId
      );
    }
  }

  /**
   * Sync league basic information
   */
  private async syncLeagueInfo(leagueId: string): Promise<void> {
    const leagueData = await sleeperClient.getLeague(leagueId);
    
    if (!leagueData) {
      throw new DataSyncError(`League not found: ${leagueId}`, 'syncLeagueInfo', leagueId);
    }
    
    await prisma.league.upsert({
      where: { sleeperLeagueId: leagueId },
      update: {
        name: leagueData.name,
        season: leagueData.season,
        seasonType: leagueData.season_type || 'regular',
        status: leagueData.status,
        sport: leagueData.sport || 'nfl',
        totalRosters: leagueData.total_rosters,
        rosterPositions: JSON.stringify(leagueData.roster_positions || []),
        scoringSettings: JSON.stringify(leagueData.scoring_settings || {}),
        previousLeagueId: leagueData.previous_league_id,
        sleeperPreviousLeagueId: leagueData.previous_league_id,
        updatedAt: new Date()
      },
      create: {
        sleeperLeagueId: leagueId,
        name: leagueData.name,
        season: leagueData.season,
        seasonType: leagueData.season_type || 'regular',
        status: leagueData.status,
        sport: leagueData.sport || 'nfl',
        totalRosters: leagueData.total_rosters,
        rosterPositions: JSON.stringify(leagueData.roster_positions || []),
        scoringSettings: JSON.stringify(leagueData.scoring_settings || {}),
        previousLeagueId: leagueData.previous_league_id,
        sleeperPreviousLeagueId: leagueData.previous_league_id
      }
    });
  }

  /**
   * Sync league users/managers
   */
  private async syncLeagueUsers(leagueId: string): Promise<void> {
    const users = await sleeperClient.getLeagueUsers(leagueId);
    
    for (const user of users) {
      await prisma.manager.upsert({
        where: { sleeperUserId: user.user_id },
        update: {
          username: user.username || user.display_name || 'Unknown',
          displayName: user.display_name,
          avatar: user.avatar,
          updatedAt: new Date()
        },
        create: {
          sleeperUserId: user.user_id,
          username: user.username || user.display_name || 'Unknown',
          displayName: user.display_name,
          avatar: user.avatar,
          isOwner: false // Will be updated when syncing rosters
        }
      });
    }
  }

  /**
   * Sync players data
   */
  private async syncPlayers(): Promise<void> {
    const playersData = await sleeperClient.getAllPlayers();
    
    // Process players in batches to avoid overwhelming the database
    const playerEntries = Object.entries(playersData);
    const batchSize = 100;
    
    for (let i = 0; i < playerEntries.length; i += batchSize) {
      const batch = playerEntries.slice(i, i + batchSize);
      
      const upsertPromises = batch.map(([playerId, player]) => 
        prisma.player.upsert({
          where: { sleeperId: playerId },
          update: {
            firstName: player.first_name,
            lastName: player.last_name,
            fullName: player.full_name,
            position: player.position,
            team: player.team,
            age: player.age,
            yearsExp: player.years_exp,
            status: player.status,
            injuryStatus: player.injury_status,
            number: player.number?.toString(),
            updatedAt: new Date()
          },
          create: {
            sleeperId: playerId,
            firstName: player.first_name,
            lastName: player.last_name,
            fullName: player.full_name,
            position: player.position,
            team: player.team,
            age: player.age,
            yearsExp: player.years_exp,
            status: player.status,
            injuryStatus: player.injury_status,
            number: player.number?.toString()
          }
        })
      );
      
      await Promise.all(upsertPromises);
    }
  }

  /**
   * Sync league rosters
   */
  private async syncLeagueRosters(leagueId: string): Promise<void> {
    const rosters = await sleeperClient.getLeagueRosters(leagueId);
    
    for (const roster of rosters) {
      // Find the manager for this roster
      const manager = await prisma.manager.findFirst({
        where: { sleeperUserId: roster.owner_id }
      });

      if (!manager) {
        console.warn(`Manager not found for roster ${roster.roster_id}, owner_id: ${roster.owner_id}`);
        continue;
      }

      const internalLeagueId = await this.getInternalLeagueId(leagueId);
      
      await prisma.roster.upsert({
        where: { 
          leagueId_sleeperRosterId_week: {
            leagueId: internalLeagueId,
            sleeperRosterId: roster.roster_id,
            week: 0
          }
        },
        update: {
          wins: roster.settings?.wins || 0,
          losses: roster.settings?.losses || 0,
          ties: roster.settings?.ties || 0,
          fpts: roster.settings?.fpts || 0,
          fptsAgainst: roster.settings?.fpts_against || 0,
          fptsDecimal: roster.settings?.fpts_decimal || 0,
          fptsAgainstDecimal: roster.settings?.fpts_against_decimal || 0,
          waiveBudgetUsed: roster.settings?.waiver_budget_used || 0,
          waiverPosition: roster.settings?.waiver_position,
          totalMoves: roster.settings?.total_moves || 0,
          division: roster.settings?.division,
          updatedAt: new Date()
        },
        create: {
          leagueId: await this.getInternalLeagueId(leagueId),
          managerId: manager.id,
          sleeperRosterId: roster.roster_id,
          week: null,
          wins: roster.settings?.wins || 0,
          losses: roster.settings?.losses || 0,
          ties: roster.settings?.ties || 0,
          fpts: roster.settings?.fpts || 0,
          fptsAgainst: roster.settings?.fpts_against || 0,
          fptsDecimal: roster.settings?.fpts_decimal || 0,
          fptsAgainstDecimal: roster.settings?.fpts_against_decimal || 0,
          waiveBudgetUsed: roster.settings?.waiver_budget_used || 0,
          waiverPosition: roster.settings?.waiver_position,
          totalMoves: roster.settings?.total_moves || 0,
          division: roster.settings?.division
        }
      });

      // Sync roster slots (current player assignments)
      if (roster.players && roster.players.length > 0) {
        // First, remove existing slots for this roster
        await prisma.rosterSlot.deleteMany({
          where: { rosterId: await this.getRosterInternalId(leagueId, roster.roster_id) }
        });

        // Add current slots
        for (let i = 0; i < roster.players.length; i++) {
          const playerId = roster.players[i];
          const position = roster.starters?.includes(playerId) 
            ? (roster.starters.indexOf(playerId) < (roster.starters.length - 1) ? 'STARTER' : 'BN')
            : 'BN';

          const player = await prisma.player.findFirst({
            where: { sleeperId: playerId }
          });

          if (player) {
            await prisma.rosterSlot.create({
              data: {
                rosterId: await this.getRosterInternalId(leagueId, roster.roster_id),
                playerId: player.id,
                position
              }
            });
          }
        }
      }
    }
  }

  /**
   * Sync all league transactions
   */
  async syncLeagueTransactions(leagueId: string): Promise<void> {
    const transactions = await sleeperClient.getAllLeagueTransactions(leagueId);
    
    for (const transaction of transactions) {
      await this.syncTransaction(leagueId, transaction);
    }
  }

  /**
   * Sync a single transaction
   */
  private async syncTransaction(leagueId: string, transaction: SleeperTransaction): Promise<void> {
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    
    const dbTransaction = await prisma.transaction.upsert({
      where: { sleeperTransactionId: transaction.transaction_id },
      update: {
        type: transaction.type,
        status: transaction.status,
        week: transaction.leg,
        leg: transaction.leg,
        timestamp: BigInt(transaction.status_updated),
        creator: transaction.creator,
        consenterIds: JSON.stringify(transaction.consenter_ids || []),
        rosterIds: JSON.stringify(transaction.roster_ids || []),
        metadata: JSON.stringify(transaction.metadata || {}),
        updatedAt: new Date()
      },
      create: {
        leagueId: internalLeagueId,
        sleeperTransactionId: transaction.transaction_id,
        type: transaction.type,
        status: transaction.status,
        week: transaction.leg,
        leg: transaction.leg,
        timestamp: BigInt(transaction.status_updated),
        creator: transaction.creator,
        consenterIds: JSON.stringify(transaction.consenter_ids || []),
        rosterIds: JSON.stringify(transaction.roster_ids || []),
        metadata: JSON.stringify(transaction.metadata || {})
      }
    });

    // Sync transaction items (adds, drops, trades)
    if (transaction.adds) {
      for (const [playerId, rosterId] of Object.entries(transaction.adds)) {
        const manager = await this.getManagerByRosterId(leagueId, Number(rosterId));
        const player = await prisma.player.findFirst({ where: { sleeperId: playerId } });

        if (player && manager) {
          // Check if this transaction item already exists
          const existingItem = await prisma.transactionItem.findFirst({
            where: {
              transactionId: dbTransaction.id,
              playerId: player.id,
              type: 'add'
            }
          });

          if (!existingItem) {
            await prisma.transactionItem.create({
              data: {
                transactionId: dbTransaction.id,
                managerId: manager.id,
                playerId: player.id,
                type: 'add',
                faabAmount: transaction.waiver_budget?.[rosterId] || null
              }
            });
          }
        }
      }
    }

    if (transaction.drops) {
      for (const [playerId, rosterId] of Object.entries(transaction.drops)) {
        const manager = await this.getManagerByRosterId(leagueId, Number(rosterId));
        const player = await prisma.player.findFirst({ where: { sleeperId: playerId } });

        if (player && manager) {
          // Check if this transaction item already exists
          const existingItem = await prisma.transactionItem.findFirst({
            where: {
              transactionId: dbTransaction.id,
              playerId: player.id,
              type: 'drop'
            }
          });

          if (!existingItem) {
            await prisma.transactionItem.create({
              data: {
                transactionId: dbTransaction.id,
                managerId: manager.id,
                playerId: player.id,
                type: 'drop'
              }
            });
          }
        }
      }
    }

    // Sync draft picks in this transaction
    if (transaction.draft_picks && transaction.draft_picks.length > 0) {
      console.log(`🎯 Processing ${transaction.draft_picks.length} draft picks in transaction ${transaction.transaction_id}`);
      for (const pick of transaction.draft_picks) {
        console.log(`  📅 ${pick.season} Round ${pick.round}: Roster ${pick.roster_id} → Roster ${pick.owner_id}`);
        // Map roster IDs to manager IDs
        const originalOwnerManager = await this.getManagerByRosterId(leagueId, pick.roster_id);
        const currentOwnerManager = pick.owner_id ? await this.getManagerByRosterId(leagueId, pick.owner_id) : null;

        if (!originalOwnerManager || !currentOwnerManager) {
          console.warn(`Could not find managers for draft pick trade: original=${pick.roster_id}, current=${pick.owner_id}`);
          continue;
        }

        // Find or create the draft pick
        const draftPick = await prisma.draftPick.upsert({
          where: {
            leagueId_season_round_originalOwnerId: {
              leagueId: internalLeagueId,
              season: pick.season,
              round: pick.round,
              originalOwnerId: originalOwnerManager.id
            }
          },
          update: {
            currentOwnerId: currentOwnerManager.id, // Update current owner after trade
            updatedAt: new Date()
          },
          create: {
            leagueId: internalLeagueId,
            season: pick.season,
            round: pick.round,
            originalOwnerId: originalOwnerManager.id,
            currentOwnerId: currentOwnerManager.id,
            pickNumber: null // Will be set during actual draft
          }
        });

        // Create transaction items for the pick trade
        // Previous owner drops the pick
        if (pick.previous_owner_id) {
          const previousOwnerManager = await this.getManagerByRosterId(leagueId, pick.previous_owner_id);
          if (previousOwnerManager) {
            const existingDropItem = await prisma.transactionItem.findFirst({
              where: {
                transactionId: dbTransaction.id,
                draftPickId: draftPick.id,
                type: 'drop'
              }
            });

            if (!existingDropItem) {
              await prisma.transactionItem.create({
                data: {
                  transactionId: dbTransaction.id,
                  managerId: previousOwnerManager.id,
                  draftPickId: draftPick.id,
                  type: 'drop'
                }
              });
            }
          }
        }

        // New owner receives the pick
        const newOwnerManager = pick.owner_id ? await this.getManagerByRosterId(leagueId, pick.owner_id) : null;
        if (newOwnerManager) {
          const existingAddItem = await prisma.transactionItem.findFirst({
            where: {
              transactionId: dbTransaction.id,
              draftPickId: draftPick.id,
              type: 'add'
            }
          });

          if (!existingAddItem) {
            await prisma.transactionItem.create({
              data: {
                transactionId: dbTransaction.id,
                managerId: newOwnerManager.id,
                draftPickId: draftPick.id,
                type: 'add'
              }
            });
          }
        }
      }
    }
  }

  /**
   * Sync draft picks for the league
   */
  private async syncLeagueDraftPicks(leagueId: string): Promise<void> {
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    
    // First, ensure all base draft picks exist for all seasons
    await this.createAllBaseDraftPicks(leagueId);
    
    // Then apply traded pick updates
    const tradedPicks = await sleeperClient.getLeagueTradedPicks(leagueId);
    
    for (const pick of tradedPicks) {
      const originalOwner = await this.getManagerByRosterId(leagueId, pick.roster_id);
      const currentOwner = await this.getManagerByRosterId(leagueId, pick.owner_id);
      const previousOwner = pick.previous_owner_id 
        ? await this.getManagerByRosterId(leagueId, pick.previous_owner_id)
        : null;

      if (originalOwner && currentOwner) {
        await prisma.draftPick.upsert({
          where: {
            leagueId_season_round_originalOwnerId: {
              leagueId: internalLeagueId,
              season: pick.season,
              round: pick.round,
              originalOwnerId: originalOwner.id
            }
          },
          update: {
            currentOwnerId: currentOwner.id,
            previousOwnerId: previousOwner?.id,
            traded: pick.roster_id !== pick.owner_id,
            updatedAt: new Date()
          },
          create: {
            leagueId: internalLeagueId,
            originalOwnerId: originalOwner.id,
            currentOwnerId: currentOwner.id,
            previousOwnerId: previousOwner?.id,
            season: pick.season,
            round: pick.round,
            traded: pick.roster_id !== pick.owner_id
          }
        });
      }
    }
  }

  /**
   * Create all base draft picks using correct draft order logic
   * This ensures we have complete draft pick records, not just traded ones
   */
  private async createAllBaseDraftPicks(leagueId: string): Promise<void> {
    console.log(`🎯 Creating all base draft picks for league: ${leagueId}`);
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    
    // Get all drafts for this league
    const drafts = await prisma.draft.findMany({
      where: { leagueId: internalLeagueId },
      orderBy: { season: 'asc' }
    });
    
    for (const draft of drafts) {
      console.log(`  📅 Creating draft picks for season ${draft.season}`);
      
      // Skip 2021 startup draft - it doesn't use tradeable picks
      if (draft.season === '2021') {
        console.log(`    ⏭️  Skipping 2021 startup draft`);
        continue;
      }
      
      // Parse draft order to understand slot -> user mapping
      const draftOrder = JSON.parse(draft.draftOrder || '{}');
      if (Object.keys(draftOrder).length === 0) {
        console.warn(`    ⚠️  No draft order data for ${draft.season}, skipping`);
        continue;
      }
      
      const rounds = 4; // Dynasty leagues typically have 4-round drafts
      const totalSlots = Object.keys(draftOrder).length;
      
      for (let round = 1; round <= rounds; round++) {
        for (let draftSlot = 1; draftSlot <= totalSlots; draftSlot++) {
          // Find the user who originally owned this draft slot
          const originalUserId = Object.keys(draftOrder).find(
            userId => draftOrder[userId] === draftSlot
          );
          
          if (!originalUserId) {
            console.warn(`    ⚠️  Could not find original owner for draft slot ${draftSlot} in ${draft.season}`);
            continue;
          }
          
          const originalOwner = await prisma.manager.findUnique({
            where: { sleeperUserId: originalUserId }
          });
          
          if (!originalOwner) {
            console.warn(`    ⚠️  Could not find manager for user ${originalUserId} in ${draft.season}`);
            continue;
          }
          
          // Check if this draft pick already exists
          const existingPick = await prisma.draftPick.findFirst({
            where: {
              leagueId: internalLeagueId,
              season: draft.season,
              round,
              originalOwnerId: originalOwner.id
            }
          });
          
          if (!existingPick) {
            await prisma.draftPick.create({
              data: {
                leagueId: internalLeagueId,
                originalOwnerId: originalOwner.id,
                currentOwnerId: originalOwner.id, // Initially same as original
                season: draft.season,
                round,
                draftSlot,
                traded: false
              }
            });
            
            console.log(`    📊 Created base draft pick: Season ${draft.season} R${round} Slot ${draftSlot} for ${originalOwner.username}`);
          }
        }
      }
    }
  }

  /**
   * Sync drafts and create draft transactions
   */
  private async syncLeagueDrafts(leagueId: string): Promise<void> {
    console.log(`🎯 Syncing drafts for league: ${leagueId}`);
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    
    // Get all drafts for this league
    const drafts = await sleeperClient.getLeagueDrafts(leagueId);
    
    for (const draftInfo of drafts) {
      console.log(`  📅 Processing draft: ${draftInfo.draft_id} (${draftInfo.season})`);
      
      // Sync draft metadata
      const dbDraft = await prisma.draft.upsert({
        where: { sleeperDraftId: draftInfo.draft_id },
        update: {
          season: draftInfo.season,
          status: draftInfo.status,
          draftType: draftInfo.type,
          rounds: draftInfo.settings?.rounds || 4,
          startTime: draftInfo.start_time ? BigInt(draftInfo.start_time) : null,
          created: draftInfo.created ? BigInt(draftInfo.created) : null,
          draftOrder: JSON.stringify(draftInfo.draft_order || {}),
          settings: JSON.stringify(draftInfo.settings || {}),
          updatedAt: new Date()
        },
        create: {
          leagueId: internalLeagueId,
          sleeperDraftId: draftInfo.draft_id,
          season: draftInfo.season,
          status: draftInfo.status,
          draftType: draftInfo.type,
          rounds: draftInfo.settings?.rounds || 4,
          startTime: draftInfo.start_time ? BigInt(draftInfo.start_time) : null,
          created: draftInfo.created ? BigInt(draftInfo.created) : null,
          draftOrder: JSON.stringify(draftInfo.draft_order || {}),
          settings: JSON.stringify(draftInfo.settings || {})
        }
      });
      
      // Get draft picks
      const picks = await sleeperClient.getDraftPicks(draftInfo.draft_id);
      console.log(`    📊 Processing ${picks.length} draft picks`);
      
      for (const pick of picks) {
        if (!pick.player_id) continue; // Skip empty picks
        
        // Find manager who made the pick
        const manager = await this.getManagerByRosterId(leagueId, pick.roster_id);
        if (!manager) {
          console.warn(`Could not find manager for roster ${pick.roster_id} in draft pick`);
          continue;
        }
        
        // Find player
        const player = await prisma.player.findFirst({
          where: { sleeperId: pick.player_id }
        });
        if (!player) {
          console.warn(`Could not find player ${pick.player_id} for draft pick`);
          continue;
        }
        
        // Create DraftSelection record
        const draftSelection = await prisma.draftSelection.upsert({
          where: {
            draftId_pickNumber: {
              draftId: dbDraft.id,
              pickNumber: pick.pick_no
            }
          },
          update: {
            round: pick.round,
            draftSlot: pick.draft_slot,
            rosterId: pick.roster_id,
            pickedBy: pick.picked_by,
            player: { connect: { id: player.id } }
          },
          create: {
            pickNumber: pick.pick_no,
            round: pick.round,
            draftSlot: pick.draft_slot,
            rosterId: pick.roster_id,
            pickedBy: pick.picked_by,
            draft: { connect: { id: dbDraft.id } },
            player: { connect: { id: player.id } }
          }
        });
        
        // Update the corresponding draft pick with pickNumber and playerSelectedId
        await this.updateDraftPickWithSelection(draftSelection, dbDraft, player, manager, leagueId);
        
        // Create draft transaction
        await this.createDraftTransaction(draftSelection, dbDraft, player, manager, leagueId);
      }
    }
  }

  /**
   * Re-sync all existing draft picks with their selection information
   */
  async resyncDraftPicks(): Promise<{ updated: number; skipped: number }> {
    console.log('🔄 Starting draft picks resync...');
    
    let updated = 0;
    let skipped = 0;
    
    try {
      // Get all draft selections that have been made
      const allDraftSelections = await prisma.draftSelection.findMany({
        include: {
          draft: {
            include: {
              league: true
            }
          },
          player: true
        },
        orderBy: [
          { draft: { season: 'asc' } },
          { pickNumber: 'asc' }
        ]
      });
      
      console.log(`📊 Found ${allDraftSelections.length} draft selections to process`);
      
      for (const selection of allDraftSelections) {
        try {
          // Get the manager who made this selection
          const manager = await prisma.manager.findUnique({
            where: { sleeperUserId: selection.pickedBy }
          });
          
          if (manager) {
            // Use our existing method to update the draft pick
            await this.updateDraftPickWithSelection(
              selection,
              selection.draft,
              selection.player,
              manager,
              selection.draft.league.sleeperLeagueId
            );
            updated++;
          } else {
            console.warn(`⚠️  Could not find manager for selection ${selection.player.fullName} (pickedBy: ${selection.pickedBy})`);
            skipped++;
          }
        } catch (error) {
          console.warn(`❌ Failed to update draft pick for ${selection.player.fullName}:`, error);
          skipped++;
        }
      }
      
      console.log(`\n✅ Draft picks resync complete: ${updated} updated, ${skipped} skipped`);
      return { updated, skipped };
      
    } catch (error) {
      console.error('❌ Draft picks resync failed:', error);
      throw error;
    }
  }

  /**
   * Find the correct draft pick for a specific selection
   * This handles cases where managers have multiple picks in the same round
   */
  private async findCorrectDraftPick(
    leagueId: string,
    season: string,
    round: number,
    draftSlot: number,
    managerId: string,
    pickNumber: number
  ): Promise<any | null> {
    // Strategy 1: Try to find by draft slot (most accurate)
    // Draft slot corresponds to original roster position and is now stored in our draft_picks
    let draftPick = await prisma.draftPick.findFirst({
      where: {
        leagueId,
        season,
        round,
        draftSlot,
        currentOwnerId: managerId
      }
    });
    
    if (draftPick) {
      console.log(`    ✅ Found draft pick by exact draftSlot match: R${round} Slot ${draftSlot}`);
      return draftPick;
    }
    
    // Strategy 2: If manager has multiple picks in this round, prefer unused picks
    const managerPicksInRound = await prisma.draftPick.findMany({
      where: {
        leagueId,
        season,
        round,
        currentOwnerId: managerId
      },
      orderBy: { draftSlot: 'asc' } // Order by draft slot for consistency
    });
    
    if (managerPicksInRound.length === 1) {
      return managerPicksInRound[0];
    }
    
    // Strategy 3: For multiple picks, prefer picks that haven't been used yet
    const unusedPick = managerPicksInRound.find(pick => !pick.playerSelectedId);
    if (unusedPick) {
      console.log(`    📊 Found unused draft pick for ${managerId} R${round} P${pickNumber}`);
      return unusedPick;
    }
    
    // Strategy 4: Try to match by draft slot even if currentOwner doesn't match (traded pick scenario)
    draftPick = await prisma.draftPick.findFirst({
      where: {
        leagueId,
        season,
        round,
        draftSlot
      }
    });
    
    if (draftPick && draftPick.currentOwnerId === managerId) {
      console.log(`    📊 Found traded pick by draftSlot: R${round} Slot ${draftSlot}`);
      return draftPick;
    }
    
    // Fallback: return first available pick with warning
    console.warn(`⚠️  Could not definitively identify correct draft pick for manager ${managerId} R${round} P${pickNumber} Slot ${draftSlot}. Using first available.`);
    return managerPicksInRound[0] || null;
  }

  /**
   * Update draft pick with selection information
   */
  private async updateDraftPickWithSelection(
    selection: any,
    draft: any,
    player: any,
    manager: any,
    leagueId: string
  ): Promise<void> {
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    
    // Use our improved matching logic to find the correct draft pick
    const draftPick = await this.findCorrectDraftPick(
      internalLeagueId,
      draft.season,
      selection.round,
      selection.draftSlot,
      manager.id,
      selection.pickNumber
    );
    
    // If we found a matching draft pick, update it with the selection info
    if (draftPick) {
      await prisma.draftPick.update({
        where: { id: draftPick.id },
        data: {
          pickNumber: selection.pickNumber,
          playerSelectedId: player.id,
          draftSlot: selection.draftSlot // Ensure draftSlot is populated
        }
      });
      
      console.log(`    📊 Updated draft pick with selection: ${player.fullName} (R${selection.round}P${selection.pickNumber} Slot ${selection.draftSlot})`);
    } else {
      console.warn(`    ⚠️  Could not find draft pick for selection: ${player.fullName} (R${selection.round}P${selection.pickNumber} Slot ${selection.draftSlot})`);
    }
  }

  /**
   * Create a draft transaction for a draft pick
   */
  private async createDraftTransaction(
    selection: any,
    draft: any,
    player: any,
    manager: any,
    leagueId: string
  ): Promise<void> {
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    
    // Create unique transaction ID for draft
    const sleeperTransactionId = `draft_${selection.id}_${player.sleeperId}`;
    
    // Check if transaction already exists
    const existingTransaction = await prisma.transaction.findFirst({
      where: { sleeperTransactionId }
    });
    
    if (existingTransaction) {
      return; // Skip if already created
    }
    
    // Create draft transaction
    const transaction = await prisma.transaction.create({
      data: {
        leagueId: internalLeagueId,
        sleeperTransactionId,
        type: 'draft',
        status: 'complete',
        week: null,
        leg: null,
        timestamp: draft.startTime || draft.created || BigInt(Date.now()),
        creator: null,
        consenterIds: JSON.stringify([]),
        rosterIds: JSON.stringify([selection.rosterId || 0]),
        metadata: JSON.stringify({
          draft_id: draft.sleeperDraftId,
          pick_number: selection.pickNumber,
          round: selection.round,
          draft_slot: selection.draftSlot
        })
      }
    });
    
    // Find the specific draft pick used for this selection
    // We need to be more precise than just round/owner since managers can have multiple picks in same round
    const draftPick = await this.findCorrectDraftPick(
      internalLeagueId,
      draft.season,
      selection.round,
      selection.draftSlot,
      manager.id,
      selection.pickNumber
    );
    
    // If pick was traded or re-acquired, add it as "currency spent"
    if (draftPick && (draftPick.originalOwnerId !== draftPick.currentOwnerId || draftPick.previousOwnerId !== null)) {
      // Validation: Check if this draft pick is already being used by another transaction
      const existingUsage = await prisma.transactionItem.findFirst({
        where: {
          draftPickId: draftPick.id,
          type: 'drop'
        },
        include: {
          transaction: true
        }
      });
      
      if (existingUsage) {
        console.warn(`⚠️  Draft pick ${draftPick.id} already used by transaction ${existingUsage.transaction.sleeperTransactionId}. Skipping duplicate association for ${player.fullName}`);
      } else {
        await prisma.transactionItem.create({
          data: {
            transactionId: transaction.id,
            managerId: manager.id,
            draftPickId: draftPick.id,
            type: 'drop' // "Spending" the traded pick
          }
        });
        
        const pickType = draftPick.originalOwnerId !== draftPick.currentOwnerId ? 'traded' : 're-acquired';
        console.log(`    💰 Associated ${pickType} draft pick with ${player.fullName} (R${selection.round}P${selection.pickNumber})`);
      }
    }
    
    // Add the player received
    await prisma.transactionItem.create({
      data: {
        transactionId: transaction.id,
        managerId: manager.id,
        playerId: player.id,
        type: 'add'
      }
    });
    
    console.log(`    ✅ Created draft transaction: ${player.fullName} (R${selection.round}P${selection.pickNumber})`);
  }

  /**
   * Sync player weekly scoring data from matchups
   */
  async syncPlayerWeeklyScores(leagueId: string): Promise<void> {
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    const league = await prisma.league.findUnique({
      where: { id: internalLeagueId }
    });

    if (!league) {
      throw new DataSyncError('League not found', 'syncPlayerWeeklyScores', leagueId);
    }

    // Get all player weekly scores from Sleeper matchups
    const allPlayerScores = await sleeperClient.getAllPlayerWeeklyScores(leagueId);

    // Process in batches to avoid overwhelming the database
    const batchSize = 100;
    for (let i = 0; i < allPlayerScores.length; i += batchSize) {
      const batch = allPlayerScores.slice(i, i + batchSize);
      
      const upsertPromises = batch.map(async (score) => {
        const player = await prisma.player.findFirst({
          where: { sleeperId: score.playerId }
        });

        if (!player) {
          console.warn(`Player not found for ID: ${score.playerId}`);
          return;
        }

        return prisma.playerWeeklyScore.upsert({
          where: {
            leagueId_playerId_week_season: {
              leagueId: internalLeagueId,
              playerId: player.id,
              week: score.week,
              season: league.season
            }
          },
          update: {
            points: score.points,
            isStarter: score.isStarter,
            matchupId: score.matchupId
          },
          create: {
            leagueId: internalLeagueId,
            playerId: player.id,
            rosterId: score.rosterId,
            week: score.week,
            season: league.season,
            points: score.points,
            isStarter: score.isStarter,
            matchupId: score.matchupId
          }
        });
      });

      await Promise.all(upsertPromises.filter(Boolean));
    }
  }

  /**
   * Sync matchup results
   */
  private async syncMatchupResults(leagueId: string): Promise<void> {
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    const league = await prisma.league.findUnique({
      where: { id: internalLeagueId }
    });

    if (!league) {
      throw new DataSyncError('League not found', 'syncMatchupResults', leagueId);
    }

    const allMatchups = await sleeperClient.getAllLeagueMatchups(leagueId);

    for (const matchup of allMatchups) {
      // Skip if no week information (shouldn't happen with updated client)
      if (!matchup.week) {
        console.warn(`Matchup missing week information for roster ${matchup.roster_id}`);
        continue;
      }

      // Find opponent in the same matchup and week
      const opponent = allMatchups.find(m => 
        m.matchup_id === matchup.matchup_id && 
        m.roster_id !== matchup.roster_id &&
        m.week === matchup.week
      );

      await prisma.matchupResult.upsert({
        where: {
          leagueId_rosterId_week_season: {
            leagueId: internalLeagueId,
            rosterId: matchup.roster_id,
            week: matchup.week,
            season: league.season
          }
        },
        update: {
          totalPoints: matchup.points,
          opponentId: opponent?.roster_id,
          won: opponent ? matchup.points > opponent.points : null
        },
        create: {
          leagueId: internalLeagueId,
          rosterId: matchup.roster_id,
          week: matchup.week,
          season: league.season,
          matchupId: matchup.matchup_id || 0,
          totalPoints: matchup.points,
          opponentId: opponent?.roster_id,
          won: opponent ? matchup.points > opponent.points : null
        }
      });
    }
  }

  /**
   * Sync NFL state data from Sleeper API
   */
  private async syncNFLState(): Promise<void> {
    try {
      // Get current NFL state
      const nflState = await sleeperClient.getNFLState();
      
      if (!nflState) {
        console.warn('No NFL state data received from Sleeper API');
        return;
      }

      // Upsert the current season's NFL state
      await prisma.nFLState.upsert({
        where: { season: nflState.season },
        update: {
          seasonType: nflState.season_type || 'regular',
          week: nflState.week || 1,
          leg: nflState.leg || 1,
          previousSeason: nflState.previous_season || '',
          seasonStartDate: nflState.season_start_date || '',
          displayWeek: nflState.display_week || nflState.week || 1,
          leagueSeason: nflState.league_season || nflState.season,
          leagueCreateSeason: nflState.season, // Usually same as season
          seasonHasScores: true, // Assume true for current API data
          lastUpdated: new Date(),
          updatedAt: new Date()
        },
        create: {
          season: nflState.season,
          seasonType: nflState.season_type || 'regular',
          week: nflState.week || 1,
          leg: nflState.leg || 1,
          previousSeason: nflState.previous_season || '',
          seasonStartDate: nflState.season_start_date || '',
          displayWeek: nflState.display_week || nflState.week || 1,
          leagueSeason: nflState.league_season || nflState.season,
          leagueCreateSeason: nflState.season,
          seasonHasScores: true
        }
      });

      console.log(`✅ NFL state synced for season ${nflState.season}`);

      // Also ensure we have historical NFL states for previous seasons (2021-2024)
      const currentYear = parseInt(nflState.season);
      const historicalSeasons = [];
      
      for (let year = 2021; year < currentYear; year++) {
        historicalSeasons.push(year.toString());
      }

      // Create minimal historical NFL state records if they don't exist
      for (const season of historicalSeasons) {
        const existingState = await prisma.nFLState.findUnique({
          where: { season }
        });

        if (!existingState) {
          await prisma.nFLState.create({
            data: {
              season,
              seasonType: 'regular',
              week: 18, // Completed seasons
              leg: 1,
              previousSeason: (parseInt(season) - 1).toString(),
              seasonStartDate: `${season}-09-01`, // Approximate start date
              displayWeek: 18,
              leagueSeason: season,
              leagueCreateSeason: season,
              seasonHasScores: true
            }
          });
          console.log(`✅ Created historical NFL state for season ${season}`);
        }
      }

    } catch (error) {
      throw new DataSyncError(
        `Failed to sync NFL state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'syncNFLState'
      );
    }
  }

  /**
   * Helper methods
   */
  private async getInternalLeagueId(sleeperLeagueId: string): Promise<string> {
    const league = await prisma.league.findUnique({
      where: { sleeperLeagueId }
    });
    if (!league) {
      throw new DataSyncError(`League not found: ${sleeperLeagueId}`, 'getInternalLeagueId');
    }
    return league.id;
  }

  private async getRosterInternalId(leagueId: string, sleeperRosterId: number): Promise<string> {
    const internalLeagueId = await this.getInternalLeagueId(leagueId);
    const roster = await prisma.roster.findFirst({
      where: {
        leagueId: internalLeagueId,
        sleeperRosterId,
        week: null
      }
    });
    if (!roster) {
      throw new DataSyncError(`Roster not found: ${sleeperRosterId}`, 'getRosterInternalId');
    }
    return roster.id;
  }

  private async getManagerByRosterId(leagueId: string, rosterId: number) {
    const rosters = await sleeperClient.getLeagueRosters(leagueId);
    const roster = rosters.find(r => r.roster_id === rosterId);
    
    if (!roster) {
      return null;
    }

    return prisma.manager.findFirst({
      where: { sleeperUserId: roster.owner_id }
    });
  }

  /**
   * Clean up resources
   */
  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }
}

// Export singleton instance
export const dataSyncService = new DataSyncService();