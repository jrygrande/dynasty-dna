import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import type { TimelineEvent } from '@/lib/api/assets';
import { groupAssetsByRecipient, formatAssetName, getUserDisplayName } from '@/lib/utils/transactions';

interface TradeDetailsModalProps {
  event: TimelineEvent;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'Unknown date';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export default function TradeDetailsModal({ event, isOpen, onOpenChange }: TradeDetailsModalProps) {
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
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-center">Trade Details</DialogTitle>
          <DialogDescription className="text-center">
            A trade occurred between two managers.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col md:flex-row justify-between items-center py-6 text-center md:text-left">
          {/* Manager 1 */}
          <div className="flex flex-col items-center md:items-start w-full md:w-1/2">
            <h3 className="font-bold text-lg mb-3">
              {managers[0]?.name || 'Manager 1'} gets:
            </h3>
            <ul className="list-none space-y-2">
              {managers[0]?.assets.map((asset, index) => (
                <li key={index} className="flex items-center space-x-2">
                  <ArrowRight size={16} className="text-emerald-500 flex-shrink-0" />
                  <span className="text-gray-700">{asset}</span>
                </li>
              )) || <li className="text-gray-500 italic">No assets</li>}
            </ul>
          </div>

          {/* Arrows in center */}
          <div className="flex justify-center md:w-auto w-full my-4 md:my-0">
            <ArrowLeft size={32} className="text-gray-400 rotate-90 md:rotate-0" />
            <ArrowRight size={32} className="text-gray-400 -rotate-90 md:rotate-0" />
          </div>

          {/* Manager 2 */}
          <div className="flex flex-col items-center md:items-end w-full md:w-1/2">
            <h3 className="font-bold text-lg mb-3">
              {managers[1]?.name || 'Manager 2'} gets:
            </h3>
            <ul className="list-none space-y-2">
              {managers[1]?.assets.map((asset, index) => (
                <li key={index} className="flex items-center md:justify-end space-x-2">
                  <span className="text-gray-700">{asset}</span>
                  <ArrowLeft size={16} className="text-emerald-500 flex-shrink-0" />
                </li>
              )) || <li className="text-gray-500 italic">No assets</li>}
            </ul>
          </div>
        </div>

        <div className="text-center text-sm text-gray-500 mt-4">
          Trade Date: {formatDate(event.eventTime)}
        </div>
      </DialogContent>
    </Dialog>
  );
}