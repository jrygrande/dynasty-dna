import React, { useState, useMemo, useCallback } from 'react';
import { Users, TrendingUp, Shuffle, UserPlus, X, Minus, Plus, Eye, EyeOff, Target } from 'lucide-react';

interface Asset {
  id: string;
  type: 'player' | 'draft_pick';
  name: string;
  position?: string;
  team?: string;
  season?: string;
  round?: number;
  originalOwnerName?: string;
  playerSelectedName?: string;
}

interface Manager {
  id: string;
  username: string;
  displayName?: string;
}

interface Transaction {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  season: string;
  week?: number;
  leagueName: string;
  assetsReceived: Asset[];
  assetsGiven: Asset[];
  managerFrom?: Manager;
  managerTo?: Manager;
  participants?: Array<{
    manager: Manager;
    assetsReceived: Asset[];
  }>;
}

interface Track {
  id: string;
  name: string;
  color: string;
  assetId?: string;
  transactions: Transaction[];
  visible: boolean;
  collapsed: boolean;
}

interface TransactionMultiTrackTimelineProps {
  focalPlayerTransactions: Transaction[];
  focalPlayerName: string;
  focalPlayerId: string;
  onFetchAssetHistory?: (assetId: string) => Promise<Transaction[]>;
  className?: string;
}

const TRACK_COLORS = [
  'bg-blue-500',
  'bg-green-500', 
  'bg-purple-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-indigo-500',
  'bg-pink-500',
  'bg-yellow-500',
  'bg-gray-500'
];

export const TransactionMultiTrackTimeline: React.FC<TransactionMultiTrackTimelineProps> = ({
  focalPlayerTransactions,
  focalPlayerName,
  focalPlayerId,
  onFetchAssetHistory,
  className = ''
}) => {
  // Track management state
  const [tracks, setTracks] = useState<Track[]>([
    {
      id: 'focal',
      name: focalPlayerName,
      color: TRACK_COLORS[0],
      assetId: focalPlayerId,
      transactions: focalPlayerTransactions,
      visible: true,
      collapsed: false
    }
  ]);

  const [openTransactionId, setOpenTransactionId] = useState<string | null>(null);
  const [loadingAssets, setLoadingAssets] = useState<Set<string>>(new Set());
  const [hoveredAsset, setHoveredAsset] = useState<string | null>(null);

  // Calculate time bounds across all visible tracks
  const { minTimestamp, maxTimestamp } = useMemo(() => {
    const visibleTracks = tracks.filter(track => track.visible);
    const allTransactions = visibleTracks.flatMap(track => track.transactions);
    
    if (allTransactions.length === 0) {
      return { minTimestamp: 0, maxTimestamp: 0 };
    }
    
    const timestamps = allTransactions.map(t => parseInt(t.timestamp));
    return {
      minTimestamp: Math.min(...timestamps),
      maxTimestamp: Math.max(...timestamps)
    };
  }, [tracks]);

  // Calculate positions for transactions based on shared time scale
  const getTimePosition = useCallback((timestamp: string): number => {
    const ts = parseInt(timestamp);
    const totalSpan = maxTimestamp - minTimestamp || 1;
    const position = ((ts - minTimestamp) / totalSpan) * 100;
    return Math.max(2, Math.min(98, position));
  }, [minTimestamp, maxTimestamp]);

  // Find asset connections across tracks
  const assetConnections = useMemo(() => {
    const connections: Array<{
      assetId: string;
      positions: Array<{ trackIndex: number; position: number; transaction: Transaction }>;
    }> = [];

    const assetPositionMap = new Map<string, Array<{ trackIndex: number; position: number; transaction: Transaction }>>();
    
    // Collect all asset positions across visible tracks
    const visibleTracks = tracks.filter(track => track.visible);
    visibleTracks.forEach((track, trackIndex) => {
      track.transactions.forEach(transaction => {
        const allAssets = [...transaction.assetsReceived, ...transaction.assetsGiven];
        allAssets.forEach(asset => {
          if (!assetPositionMap.has(asset.id)) {
            assetPositionMap.set(asset.id, []);
          }
          assetPositionMap.get(asset.id)!.push({
            trackIndex,
            position: getTimePosition(transaction.timestamp),
            transaction
          });
        });
      });
    });

    // Only include assets that appear in multiple tracks
    assetPositionMap.forEach((positions, assetId) => {
      if (positions.length > 1) {
        const uniqueTrackPositions = positions.filter((pos, index, array) => 
          array.findIndex(p => p.trackIndex === pos.trackIndex) === index
        );
        
        if (uniqueTrackPositions.length > 1) {
          connections.push({
            assetId,
            positions: uniqueTrackPositions
          });
        }
      }
    });

    return connections;
  }, [tracks, getTimePosition]);

  // Toggle transaction details
  const toggleTransactionDetails = useCallback((transactionId: string) => {
    setOpenTransactionId(prev => prev === transactionId ? null : transactionId);
  }, []);

  // Add new asset track
  const addAssetTrack = useCallback(async (asset: Asset) => {
    if (!onFetchAssetHistory) return;
    
    // Check if track already exists
    const existingTrack = tracks.find(track => track.assetId === asset.id);
    if (existingTrack) {
      // Make the track visible if it exists
      setTracks(prev => prev.map(track => 
        track.id === existingTrack.id ? { ...track, visible: true, collapsed: false } : track
      ));
      return;
    }

    setLoadingAssets(prev => new Set([...prev, asset.id]));

    try {
      const assetTransactions = await onFetchAssetHistory(asset.id);
      const nextColorIndex = tracks.length % TRACK_COLORS.length;
      
      const newTrack: Track = {
        id: asset.id,
        name: asset.name,
        color: TRACK_COLORS[nextColorIndex],
        assetId: asset.id,
        transactions: assetTransactions,
        visible: true,
        collapsed: false
      };

      setTracks(prev => [...prev, newTrack]);
    } catch (error) {
      console.error('Failed to fetch asset history:', error);
    } finally {
      setLoadingAssets(prev => {
        const newSet = new Set(prev);
        newSet.delete(asset.id);
        return newSet;
      });
    }
  }, [tracks, onFetchAssetHistory]);

  // Track visibility controls
  const toggleTrackVisibility = useCallback((trackId: string) => {
    setTracks(prev => prev.map(track => 
      track.id === trackId ? { ...track, visible: !track.visible } : track
    ));
  }, []);

  const toggleTrackCollapsed = useCallback((trackId: string) => {
    setTracks(prev => prev.map(track => 
      track.id === trackId ? { ...track, collapsed: !track.collapsed } : track
    ));
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    if (trackId === 'focal') return; // Can't remove focal track
    setTracks(prev => prev.filter(track => track.id !== trackId));
  }, []);

  // Detect overlapping transactions and assign alternating positions
  const getMarkerPosition = useCallback((transaction: Transaction, track: Track) => {
    const currentPosition = getTimePosition(transaction.timestamp);
    
    // Find other transactions in the same track that are close in time (within 8% of timeline)
    const overlappingTransactions = track.transactions.filter(t => {
      if (t.id === transaction.id) return false;
      const otherPosition = getTimePosition(t.timestamp);
      return Math.abs(currentPosition - otherPosition) < 8;
    });
    
    // Alternate above/below based on transaction index
    const transactionIndex = track.transactions.findIndex(t => t.id === transaction.id);
    const shouldAlternate = overlappingTransactions.length > 0;
    const isAbove = shouldAlternate && transactionIndex % 2 === 0;
    
    return {
      position: currentPosition,
      isAbove,
      hasOverlap: shouldAlternate
    };
  }, [getTimePosition]);

  // Transaction marker component
  const TransactionMarker: React.FC<{
    transaction: Transaction;
    track: Track;
    isOpen: boolean;
    onToggle: () => void;
  }> = ({ transaction, track, isOpen, onToggle }) => {
    const markerInfo = getMarkerPosition(transaction, track);

    const getTransactionIcon = () => {
      switch (transaction.type) {
        case 'trade': return <Shuffle className="h-3 w-3" />;
        case 'draft': return <Users className="h-3 w-3" />;
        case 'waiver': return <TrendingUp className="h-3 w-3" />;
        case 'free_agent': return <UserPlus className="h-3 w-3" />;
        default: return <Shuffle className="h-3 w-3" />;
      }
    };

    const renderAsset = (asset: Asset) => {
      const hasConnections = assetConnections.some(conn => conn.assetId === asset.id);
      const isHighlighted = hoveredAsset === asset.id;
      
      return (
        <button
          key={asset.id}
          onClick={(e) => {
            e.stopPropagation();
            addAssetTrack(asset);
          }}
          onMouseEnter={() => hasConnections && setHoveredAsset(asset.id)}
          onMouseLeave={() => setHoveredAsset(null)}
          className={`flex items-start space-x-1 p-1 rounded transition-colors ${
            isHighlighted ? 'bg-blue-100 ring-1 ring-blue-400' : 'hover:bg-gray-200'
          } ${hasConnections ? 'cursor-pointer' : ''}`}
          disabled={loadingAssets.has(asset.id)}
        >
          <div className={`w-2 h-2 rounded-full mt-1 ${
            asset.type === 'player' ? 'bg-blue-400' : 'bg-yellow-400'
          } ${isHighlighted ? 'ring-2 ring-blue-600' : ''}`}></div>
          <div className="flex flex-col items-start">
            <span className={`text-xs font-medium ${isHighlighted ? 'text-blue-700' : ''}`}>
              {asset.name}
            </span>
            {asset.type === 'draft_pick' && asset.playerSelectedName && (
              <span className="text-xs text-gray-600">
                → {asset.playerSelectedName}
              </span>
            )}
            {asset.position && (
              <span className="text-xs text-gray-500">({asset.position})</span>
            )}
          </div>
          {hasConnections && <span className="text-xs text-blue-500">↗</span>}
          {loadingAssets.has(asset.id) && <span className="text-xs text-gray-400">...</span>}
        </button>
      );
    };

    return (
      <>
        <div
          className={`absolute transform -translate-x-1/2 ${markerInfo.isAbove ? 'bottom-10' : 'top-10'}`}
          style={{ left: `${markerInfo.position}%` }}
        >
          {/* Compact marker */}
          <button
            onClick={onToggle}
            className={`${track.color} ${isOpen ? 'ring-2 ring-yellow-400' : ''} ${markerInfo.hasOverlap ? (markerInfo.isAbove ? 'mb-2' : 'mt-2') : ''} rounded-lg px-2 py-1 text-white cursor-pointer transition-all duration-200 hover:scale-105 shadow-sm flex items-center space-x-1`}
          >
            {getTransactionIcon()}
            <span className="text-xs font-medium">
              {transaction.type === 'trade' && transaction.participants?.length >= 2
                ? `${transaction.participants[0].manager.displayName || transaction.participants[0].manager.username} ↔ ${transaction.participants[1].manager.displayName || transaction.participants[1].manager.username}`
                : (transaction.managerTo?.displayName || transaction.managerFrom?.displayName || 'Unknown')
              }
            </span>
          </button>
          
          {markerInfo.hasOverlap && (
            <div className={`w-px h-4 bg-gray-400 mx-auto ${markerInfo.isAbove ? 'order-2' : ''}`}></div>
          )}
        </div>

        {/* Modal overlay and details when open */}
        {isOpen && (
          <>
            <div 
              className="fixed inset-0 bg-black bg-opacity-25 z-40" 
              onClick={onToggle}
            />
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white border border-gray-300 rounded-lg shadow-xl p-6 z-50 min-w-96 max-w-md max-h-96 overflow-y-auto">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="font-bold text-sm capitalize">{transaction.type.replace('_', ' ')}</div>
                <div className="text-xs text-gray-500">
                  {new Date(parseInt(transaction.timestamp)).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={onToggle}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Trade view */}
            {transaction.type === 'trade' && transaction.participants?.length >= 2 ? (
              <div className="grid grid-cols-2 gap-3">
                {transaction.participants.map((participant, idx) => (
                  <div key={participant.manager.id} className="p-2 bg-gray-50 rounded">
                    <div className="font-semibold text-xs mb-2">
                      {participant.manager.displayName || participant.manager.username} received:
                    </div>
                    <div className="space-y-1">
                      {participant.assetsReceived.length > 0 ? (
                        participant.assetsReceived.map((asset) => renderAsset(asset))
                      ) : (
                        <div className="text-xs text-gray-500">Nothing</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Non-trade view */
              <div className="grid grid-cols-2 gap-3">
                {transaction.assetsGiven.length > 0 && (
                  <div className="p-2 bg-red-50 rounded">
                    <div className="font-semibold text-xs mb-2">
                      {transaction.type === 'draft' ? 'Available:' : 'Dropped:'}
                    </div>
                    <div className="space-y-1">
                      {transaction.assetsGiven.map((asset) => renderAsset(asset))}
                    </div>
                  </div>
                )}
                
                {transaction.assetsReceived.length > 0 && (
                  <div className="p-2 bg-green-50 rounded">
                    <div className="font-semibold text-xs mb-2">
                      {transaction.type === 'draft' ? 'Selected:' : 'Added:'}
                    </div>
                    <div className="space-y-1">
                      {transaction.assetsReceived.map((asset) => renderAsset(asset))}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </>
        )}
      </>
    );
  };

  // Simple Draft Selection Marker - only shows when a draft pick was used
  const DraftSelectionMarker: React.FC<{ track: Track }> = ({ track }) => {
    // Only show for draft pick tracks that have been selected
    if (!track.assetId || track.id === 'focal') return null;
    
    // Find if this track represents a draft pick that was used
    const draftPickAsset = track.transactions
      .flatMap(t => [...t.assetsReceived, ...t.assetsGiven])
      .find(asset => asset.id === track.assetId && asset.type === 'draft_pick' && asset.playerSelectedName);
    
    if (!draftPickAsset) return null;

    // Position the marker at the end of the timeline (when pick was used)
    // We'll use the last transaction as a reference point, since draft selections
    // happen after trades
    const lastTransaction = track.transactions[track.transactions.length - 1];
    if (!lastTransaction) return null;

    const position = getTimePosition(lastTransaction.timestamp) + 5; // Offset slightly to the right

    const handleAddSelectedPlayer = () => {
      // Create an Asset object for the selected player
      const selectedPlayerAsset: Asset = {
        id: draftPickAsset.playerSelectedId || '', // Use playerSelectedId from draft pick
        type: 'player',
        name: draftPickAsset.playerSelectedName || '',
        position: '', // Position not available in draft pick data
        team: '' // Team not available in draft pick data
      };
      
      addAssetTrack(selectedPlayerAsset);
    };

    return (
      <div
        className="absolute transform -translate-x-1/2 z-30"
        style={{ left: `${position}%` }}
      >
        <div className="relative group">
          <button
            onClick={handleAddSelectedPlayer}
            className="bg-green-500 text-white rounded-lg px-2 py-1 shadow-lg flex items-center space-x-1 transition-all duration-200 hover:scale-105 hover:bg-green-600 cursor-pointer"
          >
            <Target className="h-3 w-3" />
            <span className="text-xs font-medium">Selected</span>
          </button>
          
          {/* Tooltip */}
          <div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-white border border-gray-300 rounded-lg shadow-lg p-3 z-40 min-w-48 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="font-bold text-sm text-green-700 mb-1">
              🎯 Draft Selection
            </div>
            <div className="text-sm font-semibold mb-1">
              {draftPickAsset.playerSelectedName}
            </div>
            <div className="text-xs text-gray-600 mb-2">
              {draftPickAsset.season} Round {draftPickAsset.round} Pick
            </div>
            <div className="text-xs text-blue-600 font-medium">
              Click to add {draftPickAsset.playerSelectedName} to timeline
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Track component
  const TrackRow: React.FC<{ track: Track; trackIndex: number }> = ({ track, trackIndex }) => {
    if (!track.visible) return null;

    return (
      <div className="mb-8 border border-gray-200 rounded-lg bg-gray-50 shadow-sm">
        {/* Track header */}
        <div className="flex items-center justify-between p-3 bg-white border-b border-gray-200 rounded-t-lg">
          <div className="flex items-center space-x-2">
            <div className={`w-4 h-4 rounded ${track.color}`}></div>
            <span className="font-semibold text-sm">{track.name}</span>
            <span className="text-xs text-gray-500">({track.transactions.length} transactions)</span>
          </div>
          
          <div className="flex items-center space-x-1">
            <button
              onClick={() => toggleTrackCollapsed(track.id)}
              className="p-1 text-gray-400 hover:text-gray-600"
              title={track.collapsed ? 'Expand track' : 'Collapse track'}
            >
              {track.collapsed ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
            </button>
            
            <button
              onClick={() => toggleTrackVisibility(track.id)}
              className="p-1 text-gray-400 hover:text-gray-600"
              title="Hide track"
            >
              <EyeOff className="h-4 w-4" />
            </button>
            
            {track.id !== 'focal' && (
              <button
                onClick={() => removeTrack(track.id)}
                className="p-1 text-gray-400 hover:text-red-600"
                title="Remove track"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Track timeline */}
        {!track.collapsed && (
          <div className="relative p-6" style={{ height: '120px' }}>
            {/* Timeline line */}
            <div className="absolute top-1/2 left-6 right-6 h-0.5 bg-gray-400 shadow-sm"></div>
            
            {/* Transaction markers */}
            {track.transactions.map((transaction) => (
              <TransactionMarker
                key={transaction.id}
                transaction={transaction}
                track={track}
                isOpen={openTransactionId === transaction.id}
                onToggle={() => toggleTransactionDetails(transaction.id)}
              />
            ))}
            
            {/* Draft selection marker - only for draft picks that were used */}
            <DraftSelectionMarker track={track} />
          </div>
        )}
      </div>
    );
  };

  // Generate time markers for the shared time scale
  const timeMarkers = useMemo(() => {
    if (minTimestamp === 0 || maxTimestamp === 0) return [];
    
    const firstDate = new Date(minTimestamp);
    const lastDate = new Date(maxTimestamp);
    const markers = [];
    
    const currentDate = new Date(firstDate.getFullYear(), 0, 1);
    while (currentDate <= lastDate) {
      const timestamp = currentDate.getTime();
      const position = getTimePosition(timestamp.toString());
      
      if (position >= 0 && position <= 100) {
        markers.push({
          year: currentDate.getFullYear(),
          position
        });
      }
      
      currentDate.setFullYear(currentDate.getFullYear() + 1);
    }
    
    return markers;
  }, [minTimestamp, maxTimestamp, getTimePosition]);

  const visibleTracks = tracks.filter(track => track.visible);
  const hiddenTracks = tracks.filter(track => !track.visible);

  return (
    <div className={`multi-track-timeline ${className}`}>
      {/* Track controls */}
      {hiddenTracks.length > 0 && (
        <div className="mb-4 p-3 bg-gray-100 rounded-lg">
          <div className="text-sm font-semibold mb-2">Hidden Tracks:</div>
          <div className="flex flex-wrap gap-2">
            {hiddenTracks.map(track => (
              <button
                key={track.id}
                onClick={() => toggleTrackVisibility(track.id)}
                className="flex items-center space-x-1 px-2 py-1 bg-white rounded text-sm border hover:bg-gray-50"
              >
                <Eye className="h-3 w-3" />
                <span>{track.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Enhanced Timeline Ruler */}
      {timeMarkers.length > 0 && (
        <div className="relative mb-6 mx-4 border-b border-gray-200 pb-2" style={{ height: '40px' }}>
          {/* Ruler line */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gray-300"></div>
          
          {timeMarkers.map((marker, index) => (
            <div
              key={index}
              className="absolute transform -translate-x-1/2"
              style={{ left: `${marker.position}%`, bottom: '0px' }}
            >
              <div className="text-sm text-gray-700 font-semibold mb-1 bg-white px-2 py-1 rounded shadow-sm border">
                {marker.year}
              </div>
              <div className="w-0.5 h-3 bg-gray-500 mx-auto"></div>
            </div>
          ))}
        </div>
      )}

      {/* Track rows */}
      <div className="relative space-y-0">
        {visibleTracks.map((track, index) => (
          <TrackRow key={track.id} track={track} trackIndex={index} />
        ))}
        
        {/* Connection Lines */}
        {hoveredAsset && (
          <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
            style={{ height: `${visibleTracks.length * 180}px` }}
          >
            {assetConnections
              .filter(conn => conn.assetId === hoveredAsset)
              .map(connection => (
                connection.positions.map((pos1, idx1) => 
                  connection.positions.slice(idx1 + 1).map((pos2, idx2) => (
                    <line
                      key={`${idx1}-${idx2}`}
                      x1={`${pos1.position}%`}
                      y1={`${pos1.trackIndex * 180 + 90}px`}
                      x2={`${pos2.position}%`}
                      y2={`${pos2.trackIndex * 180 + 90}px`}
                      stroke="#3b82f6"
                      strokeWidth="2"
                      strokeDasharray="4,4"
                      opacity="0.7"
                    />
                  ))
                ).flat()
              ))
              .flat()
            }
          </svg>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <div className="text-sm text-blue-800">
          <div className="font-semibold mb-1">How to use:</div>
          <ul className="text-xs space-y-1">
            <li>• Click transaction markers to persist/unpersist them</li>
            <li>• Click assets in persisted transactions to create new tracks</li>
            <li>• Hover assets with ↗ symbol to see connections across tracks</li>
            <li>• Use track controls to hide, collapse, or remove tracks</li>
            <li>• All tracks share the same time scale for easy comparison</li>
          </ul>
        </div>
      </div>
    </div>
  );
};