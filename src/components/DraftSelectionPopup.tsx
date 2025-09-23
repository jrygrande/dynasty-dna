'use client';

import React, { useState, useEffect } from 'react';
import type { TimelineEvent } from '@/lib/api/assets';
import { formatAssetName, getUserDisplayName } from '@/lib/utils/transactions';

interface DraftSelectionPopupProps {
  event: TimelineEvent;
  playerId?: string;
}

const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'Unknown date';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getPlayerName = async (event: TimelineEvent, currentPlayerId?: string): Promise<string> => {
  let playerId: string | undefined;

  // Check if we have player ID information in details
  if (event.details && typeof event.details === 'object') {
    const details = event.details as any;
    if (details.playerId) {
      playerId = details.playerId;
    }
  }

  // Use the current player context from the timeline
  if (!playerId && currentPlayerId) {
    playerId = currentPlayerId;
  }

  // If we have a player ID, fetch the actual player data via API
  if (playerId) {
    try {
      const response = await fetch(`/api/players/${playerId}`);
      if (response.ok) {
        const player = await response.json();
        if (player && player.name) {
          return player.name;
        }
      }
    } catch (error) {
      console.error('Failed to fetch player via API:', error);
    }

    // Fallback to formatted asset name if API fetch fails
    return formatAssetName({ assetKind: 'player', playerId });
  }

  // Fallback to unknown player
  return 'Unknown Player';
};

export default function DraftSelectionPopup({ event, playerId }: DraftSelectionPopupProps) {
  const [playerName, setPlayerName] = useState<string>('Loading...');
  const managerName = getUserDisplayName(event.toUser);

  useEffect(() => {
    getPlayerName(event, playerId).then(setPlayerName);
  }, [event, playerId]);

  // Extract draft details
  const details = (event.details || {}) as any;
  const round = details.round || '?';
  const pickNo = details.pickNo || '?';

  return (
    <div className="space-y-2">
      <div className="text-center">
        <h4 className="font-bold text-sm text-gray-900">Draft Selection</h4>
        <p className="text-xs text-gray-500">{formatDate(event.eventTime)}</p>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Selected by:</span>
          <span className="font-medium text-gray-900 truncate ml-2">{managerName}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-600">Player:</span>
          <span className="font-medium text-emerald-600 truncate ml-2">{playerName}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-600">Pick:</span>
          <span className="font-medium text-gray-900">R{round} #{pickNo}</span>
        </div>
      </div>
    </div>
  );
}