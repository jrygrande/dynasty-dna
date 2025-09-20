import { NextRequest, NextResponse } from 'next/server';
import { getPlayer } from '@/repositories/players';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const playerId = params.id;

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID is required' }, { status: 400 });
    }

    const player = await getPlayer(playerId);

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    return NextResponse.json(player);
  } catch (error) {
    console.error('Error fetching player:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}