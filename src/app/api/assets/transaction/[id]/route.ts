import { NextRequest, NextResponse } from 'next/server';
import { getAssetsInTransaction } from '@/repositories/assetEvents';
import { getDb } from '@/db/index';
import { transactions } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const transactionId = params.id;
        const { searchParams } = new URL(req.url);
        const leagueId = searchParams.get('leagueId') || searchParams.get('league_id');

        if (!transactionId) {
            return NextResponse.json(
                { ok: false, error: 'Transaction ID is required' },
                { status: 400 }
            );
        }

        // Fetch transaction details
        const db = await getDb();
        const txRows = await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, transactionId))
            .limit(1);

        if (txRows.length === 0) {
            return NextResponse.json(
                { ok: false, error: 'Transaction not found' },
                { status: 404 }
            );
        }

        const transaction = txRows[0];

        // Fetch all assets involved in this transaction
        const assets = await getAssetsInTransaction(transactionId);

        // Get user information for the transaction
        const { getUserById } = await import('@/repositories/users');
        const userIds = new Set<string>();

        for (const asset of assets) {
            if (asset.fromUserId) userIds.add(asset.fromUserId);
            if (asset.toUserId) userIds.add(asset.toUserId);
        }

        const users = new Map<string, any>();
        for (const userId of userIds) {
            try {
                const user = await getUserById(userId);
                if (user) {
                    users.set(userId, {
                        id: user.id,
                        username: user.username,
                        displayName: user.displayName || user.username,
                    });
                }
            } catch (error) {
                console.error(`Failed to fetch user ${userId}:`, error);
            }
        }

        // Enhance assets with user information
        const enhancedAssets = assets.map(asset => ({
            id: asset.id,
            assetKind: asset.assetKind,
            eventType: asset.eventType,
            playerId: asset.playerId,
            playerName: asset.playerName,
            playerPosition: asset.playerPosition,
            playerTeam: asset.playerTeam,
            pickSeason: asset.pickSeason,
            pickRound: asset.pickRound,
            pickOriginalRosterId: asset.pickOriginalRosterId,
            fromRosterId: asset.fromRosterId,
            toRosterId: asset.toRosterId,
            fromUser: asset.fromUserId ? users.get(asset.fromUserId) || null : null,
            toUser: asset.toUserId ? users.get(asset.toUserId) || null : null,
        }));

        return NextResponse.json({
            ok: true,
            transaction: {
                id: transaction.id,
                leagueId: transaction.leagueId,
                type: transaction.type,
                week: transaction.week,
                eventTime: transaction.createdAt?.toISOString() || null,
                assets: enhancedAssets,
            },
        });
    } catch (e: any) {
        console.error('Failed to fetch transaction:', e);
        return NextResponse.json(
            { ok: false, error: e?.message || 'Failed to fetch transaction' },
            { status: 500 }
        );
    }
}
