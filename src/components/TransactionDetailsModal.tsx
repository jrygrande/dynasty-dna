import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Clock, Users, ArrowRight } from 'lucide-react';
import type { TimelineEvent } from '@/lib/api/assets';
import { groupAssetsByRecipient, formatAssetName, getUserDisplayName } from '@/lib/utils/transactions';

interface TransactionDetailsModalProps {
  event: TimelineEvent | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatEventType = (eventType: string): string => {
  return eventType
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatDateTime = (value: string | null): string => {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
};

const getUserDisplay = (user: { id: string; username: string | null; displayName: string | null } | null): string => {
  if (!user) return 'Unknown';
  return user.displayName || user.username || user.id;
};

const renderDetails = (details: unknown) => {
  if (!details || typeof details !== 'object') return null;

  const detailsObj = details as Record<string, any>;
  const entries = Object.entries(detailsObj).filter(([key, value]) =>
    value !== null && value !== undefined && value !== ''
  );

  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Additional Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex justify-between items-center text-sm">
            <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
            <span className="font-medium">{String(value)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default function TransactionDetailsModal({
  event,
  isOpen,
  onOpenChange
}: TransactionDetailsModalProps) {
  console.log('Modal render:', { isOpen, hasEvent: !!event });
  if (!event) return null;

  const isTradeEvent = event.eventType === 'trade' || event.eventType === 'pick_trade';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="secondary">
              {formatEventType(event.eventType)}
            </Badge>
            <span>Transaction Details</span>
          </DialogTitle>
          <DialogDescription>
            {formatDateTime(event.eventTime)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-gray-500" />
              <span>Season {event.season || 'Unknown'}, Week {event.week || 'Unknown'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-gray-500" />
              <span>
                {event.eventTime ? new Date(event.eventTime).toLocaleDateString() : 'Unknown date'}
              </span>
            </div>
          </div>

          <Separator />

          {/* Roster Movement */}
          {isTradeEvent ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Trade Partners
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-center">
                    <div className="text-sm text-gray-500 mb-1">From</div>
                    <div className="font-medium">{getUserDisplay(event.fromUser)}</div>
                    {event.fromRosterId && (
                      <div className="text-xs text-gray-400">Roster #{event.fromRosterId}</div>
                    )}
                  </div>
                  <ArrowRight className="w-6 h-6 text-gray-400" />
                  <div className="text-center">
                    <div className="text-sm text-gray-500 mb-1">To</div>
                    <div className="font-medium">{getUserDisplay(event.toUser)}</div>
                    {event.toRosterId && (
                      <div className="text-xs text-gray-400">Roster #{event.toRosterId}</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Roster Movement
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-500 mb-1">From</div>
                    <div className="font-medium">{getUserDisplay(event.fromUser) || '—'}</div>
                    {event.fromRosterId && (
                      <div className="text-xs text-gray-400">Roster #{event.fromRosterId}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">To</div>
                    <div className="font-medium">{getUserDisplay(event.toUser) || '—'}</div>
                    {event.toRosterId && (
                      <div className="text-xs text-gray-400">Roster #{event.toRosterId}</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Transaction ID */}
          {event.transactionId && (
            <div className="text-xs text-gray-500">
              Transaction ID: <code className="bg-gray-100 px-1 py-0.5 rounded">{event.transactionId}</code>
            </div>
          )}

          {/* Additional Details */}
          {renderDetails(event.details)}

          {/* Assets in Transaction */}
          {event.assetsInTransaction && event.assetsInTransaction.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Assets Involved</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {groupAssetsByRecipient(
                    event.assetsInTransaction,
                    event.fromUser,
                    event.toUser,
                    event.fromRosterId,
                    event.toRosterId
                  ).map(({ userId, user, assets: userAssets }) => {
                    const userName = getUserDisplayName(user);
                    const assetNames = userAssets.map(formatAssetName);

                    return (
                      <div key={userId} className="bg-blue-50 p-4 rounded-lg">
                        <div className="font-medium text-blue-800 mb-2">
                          {userName} received:
                        </div>
                        <div className="space-y-1">
                          {assetNames.map((assetName, index) => (
                            <Badge key={index} variant="outline" className="mr-2 mb-1">
                              {assetName}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}