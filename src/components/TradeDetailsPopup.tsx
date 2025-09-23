'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { TimelineEvent } from '@/lib/api/assets';
import { groupAssetsByRecipient, formatAssetName, getUserDisplayName } from '@/lib/utils/transactions';

interface TradeDetailsPopupProps {
  event: TimelineEvent;
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

export default function TradeDetailsPopup({ event }: TradeDetailsPopupProps) {
  // Group assets by recipient
  const groupedAssets = groupAssetsByRecipient(
    event.assetsInTransaction || [],
    event.fromUser,
    event.toUser,
    event.fromRosterId,
    event.toRosterId
  );

  // Convert to manager-based format for display
  const managers = groupedAssets.map(({ user, assets }) => ({
    name: getUserDisplayName(user),
    assets: assets.map(formatAssetName)
  }));

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h4 className="font-bold text-sm text-gray-900">Trade Details</h4>
        <p className="text-xs text-gray-500">{formatDate(event.eventTime)}</p>
      </div>

      <div className="space-y-2">
        {/* Manager 1 Gets */}
        <div>
          <h5 className="font-medium text-xs text-gray-700 mb-1">
            {managers[0]?.name || 'Manager 1'} gets:
          </h5>
          <div className="space-y-1">
            {managers[0]?.assets.map((asset, index) => (
              <div key={index} className="flex items-center space-x-1 text-xs">
                <ArrowRight size={12} className="text-emerald-500 flex-shrink-0" />
                <span className="text-gray-600 truncate">{asset}</span>
              </div>
            )) || <div className="text-xs text-gray-400 italic">No assets</div>}
          </div>
        </div>

        {/* Manager 2 Gets */}
        <div>
          <h5 className="font-medium text-xs text-gray-700 mb-1">
            {managers[1]?.name || 'Manager 2'} gets:
          </h5>
          <div className="space-y-1">
            {managers[1]?.assets.map((asset, index) => (
              <div key={index} className="flex items-center space-x-1 text-xs">
                <ArrowRight size={12} className="text-emerald-500 flex-shrink-0" />
                <span className="text-gray-600 truncate">{asset}</span>
              </div>
            )) || <div className="text-xs text-gray-400 italic">No assets</div>}
          </div>
        </div>
      </div>
    </div>
  );
}