'use client';

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface DataFreshnessWidgetProps {
  leagueId?: string;
}

interface SyncStatus {
  lastSyncAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'failed';
  isStale: boolean;
  checkedAt: string;
}

export function DataFreshnessWidget({ leagueId }: DataFreshnessWidgetProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const formatLastSync = (lastSyncAt: string | null): string => {
    if (!lastSyncAt) return 'Never synced';

    const syncDate = new Date(lastSyncAt);
    const now = new Date();
    const diffMs = now.getTime() - syncDate.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    // Format in user's timezone
    const timeFormat = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const dateFormat = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });

    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return dateFormat.format(syncDate);
    }
  };

  const getStatusColor = (status: SyncStatus): string => {
    if (status.syncStatus === 'syncing') return 'text-blue-600';
    if (status.syncStatus === 'failed') return 'text-red-600';
    if (status.isStale) return 'text-amber-600';
    return 'text-green-600';
  };

  const getStatusIcon = (status: SyncStatus) => {
    const iconClass = "h-3 w-3";

    if (status.syncStatus === 'syncing') {
      return <Clock className={`${iconClass} animate-pulse`} />;
    }
    // No icon for other states
    return null;
  };

  useEffect(() => {
    if (!leagueId) return;

    const checkSyncStatus = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sync/status?leagueId=${leagueId}`);
        const data = await response.json();

        if (data.ok) {
          setSyncStatus(data);
        } else {
          setError('Failed to check sync status');
        }
      } catch (err) {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    // Check immediately
    checkSyncStatus();

    // Check every 30 seconds
    const interval = setInterval(checkSyncStatus, 30000);

    return () => clearInterval(interval);
  }, [leagueId]);

  // Don't render if no league ID
  if (!leagueId) return null;

  // Don't render if still loading and no data
  if (loading && !syncStatus) return null;

  // Don't render if error and no previous data
  if (error && !syncStatus) return null;

  const handleRefresh = async () => {
    if (!leagueId || isRefreshing) return;

    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch(`/api/sync/trigger?leagueId=${leagueId}`, {
        method: 'POST',
      });
      const data = await response.json();

      if (data.ok && !data.alreadyRunning) {
        // Optimistically update UI to show syncing state
        setSyncStatus(prev => prev ? { ...prev, syncStatus: 'syncing' } : null);
        // Polling will pick up the actual status changes
      } else if (data.alreadyRunning) {
        // Already syncing, no need to do anything
        console.log('Sync already in progress');
      } else {
        setError('Failed to trigger refresh');
      }
    } catch (err) {
      console.error('Failed to trigger refresh:', err);
      setError('Network error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const statusText = syncStatus ? formatLastSync(syncStatus.lastSyncAt) : 'Checking...';
  const statusColor = syncStatus ? getStatusColor(syncStatus) : 'text-gray-500';

  return (
    <div className="w-full flex justify-center py-4 mt-8 border-t border-gray-100">
      <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
        <div className="flex items-center gap-3 text-xs">
          {syncStatus && getStatusIcon(syncStatus)}
          <span className={`font-medium ${statusColor}`}>
            Data synced: {statusText}
          </span>
          {syncStatus?.syncStatus === 'syncing' && (
            <span className="text-blue-600 text-xs">Updating...</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || syncStatus?.syncStatus === 'syncing'}
            className="text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed font-medium"
            title="Refresh data now"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
}