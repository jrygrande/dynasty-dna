import React, { useState, useMemo } from 'react';
import { Calendar, ArrowRight, Users, TrendingUp, Shuffle, UserPlus, ZoomIn, ZoomOut } from 'lucide-react';

interface Asset {
  id: string;
  type: 'player' | 'draft_pick';
  name: string;
  position?: string;
  team?: string;
  season?: string;
  round?: number;
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

interface TransactionTimelineProps {
  transactions: Transaction[];
  className?: string;
}

const TransactionMarker: React.FC<{
  transaction: Transaction;
  position: number;
  hoveredTransaction: string | null;
  onHover: (id: string | null) => void;
}> = ({ transaction, position, hoveredTransaction, onHover }) => {
  const getTransactionIcon = () => {
    switch (transaction.type) {
      case 'trade':
        return <Shuffle className="h-3 w-3" />;
      case 'draft':
        return <Users className="h-3 w-3" />;
      case 'waiver':
        return <TrendingUp className="h-3 w-3" />;
      case 'free_agent':
        return <UserPlus className="h-3 w-3" />;
      default:
        return <Shuffle className="h-3 w-3" />;
    }
  };

  const getTransactionColor = () => {
    switch (transaction.type) {
      case 'trade':
        return 'bg-blue-500';
      case 'draft':
        return 'bg-green-500';
      case 'waiver':
        return 'bg-orange-500';
      case 'free_agent':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  const isHovered = hoveredTransaction === transaction.id;
  const markerSize = isHovered ? 'h-4 w-4' : 'h-3 w-3';
  const markerClass = `${markerSize} ${getTransactionColor()} rounded-full flex items-center justify-center text-white cursor-pointer transition-all duration-200 transform ${isHovered ? 'scale-125' : ''}`;

  const formatDate = (timestamp: string) => {
    const date = new Date(parseInt(timestamp));
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatAsset = (asset: Asset) => {
    if (asset.type === 'player') {
      return (
        <div className="flex items-center space-x-1">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
          <span className="font-medium text-sm">{asset.name}</span>
          {asset.position && (
            <span className="text-xs text-gray-500">({asset.position})</span>
          )}
        </div>
      );
    } else if (asset.type === 'draft_pick') {
      return (
        <div className="flex items-center space-x-1">
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-400"></div>
          <span className="font-medium text-sm">
            {asset.season} R{asset.round} Pick
          </span>
        </div>
      );
    }
    return <span className="text-sm">{asset.name}</span>;
  };

  return (
    <div
      className="absolute transform -translate-x-1/2"
      style={{ left: `${position}%` }}
      onMouseEnter={() => onHover(transaction.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Transaction Marker */}
      <div className={markerClass}>
        {getTransactionIcon()}
      </div>
      
      {/* Hover Popup */}
      {isHovered && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white p-3 rounded-lg shadow-lg z-20 min-w-80 max-w-md">
          <div className="text-xs text-gray-300 mb-1">{formatDate(transaction.timestamp)}</div>
          <div className="font-bold text-sm mb-2 capitalize">{transaction.type.replace('_', ' ')}</div>
          
          {/* Trade View - Show what each participant received */}
          {transaction.type === 'trade' && transaction.participants && transaction.participants.length >= 2 ? (
            <div className="grid grid-cols-2 gap-3">
              {transaction.participants.map((participant, idx) => (
                <div key={participant.manager.id} className={`p-2 rounded ${idx === 0 ? 'bg-blue-800/30' : 'bg-green-800/30'}`}>
                  <div className="text-xs font-semibold mb-1 text-gray-200">
                    {participant.manager.displayName || participant.manager.username}
                  </div>
                  <div className="text-xs text-gray-300 mb-1">Received:</div>
                  <div className="space-y-1">
                    {participant.assetsReceived.length > 0 ? (
                      participant.assetsReceived.slice(0, 3).map((asset, assetIdx) => (
                        <div key={assetIdx}>
                          {formatAsset(asset)}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-gray-500">Nothing</div>
                    )}
                    {participant.assetsReceived.length > 3 && (
                      <div className="text-xs text-gray-500">+{participant.assetsReceived.length - 3} more</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Non-Trade View */
            <div className="grid grid-cols-2 gap-3">
              {transaction.assetsGiven.length > 0 && (
                <div className="p-2 rounded bg-red-800/30">
                  <div className="text-xs font-semibold mb-1 text-gray-200">Given:</div>
                  <div className="space-y-1">
                    {transaction.assetsGiven.slice(0, 3).map((asset, idx) => (
                      <div key={idx}>
                        {formatAsset(asset)}
                      </div>
                    ))}
                    {transaction.assetsGiven.length > 3 && (
                      <div className="text-xs text-gray-500">+{transaction.assetsGiven.length - 3} more</div>
                    )}
                  </div>
                </div>
              )}
              
              {transaction.assetsReceived.length > 0 && (
                <div className="p-2 rounded bg-green-800/30">
                  <div className="text-xs font-semibold mb-1 text-gray-200">Received:</div>
                  <div className="space-y-1">
                    {transaction.assetsReceived.slice(0, 3).map((asset, idx) => (
                      <div key={idx}>
                        {formatAsset(asset)}
                      </div>
                    ))}
                    {transaction.assetsReceived.length > 3 && (
                      <div className="text-xs text-gray-500">+{transaction.assetsReceived.length - 3} more</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const TransactionTimeline: React.FC<TransactionTimelineProps> = ({
  transactions,
  className = ''
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [hoveredTransaction, setHoveredTransaction] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  
  // Sort transactions chronologically
  const sortedTransactions = useMemo(() => {
    return [...transactions].sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));
  }, [transactions]);

  // Filter transactions by type
  const filteredTransactions = useMemo(() => {
    if (filterType === 'all') return sortedTransactions;
    return sortedTransactions.filter(t => t.type === filterType);
  }, [sortedTransactions, filterType]);

  // Calculate time-based positions
  const timelineData = useMemo(() => {
    if (filteredTransactions.length === 0) return [];
    
    const firstTimestamp = parseInt(filteredTransactions[0].timestamp);
    const lastTimestamp = parseInt(filteredTransactions[filteredTransactions.length - 1].timestamp);
    const totalTimeSpan = lastTimestamp - firstTimestamp || 1;
    
    return filteredTransactions.map((transaction, index) => {
      const timestamp = parseInt(transaction.timestamp);
      const relativeTime = timestamp - firstTimestamp;
      const position = (relativeTime / totalTimeSpan) * 100;
      
      return {
        transaction,
        position: Math.max(5, Math.min(95, position)) // Keep within 5-95% range
      };
    });
  }, [filteredTransactions]);

  // Get unique transaction types for filter
  const transactionTypes = useMemo(() => {
    const types = new Set(transactions.map(t => t.type));
    return Array.from(types);
  }, [transactions]);

  // Generate time markers
  const timeMarkers = useMemo(() => {
    if (filteredTransactions.length === 0) return [];
    
    const firstDate = new Date(parseInt(filteredTransactions[0].timestamp));
    const lastDate = new Date(parseInt(filteredTransactions[filteredTransactions.length - 1].timestamp));
    
    const markers = [];
    const currentDate = new Date(firstDate.getFullYear(), 0, 1); // Start of first year
    
    while (currentDate <= lastDate) {
      const timestamp = currentDate.getTime();
      const firstTimestamp = parseInt(filteredTransactions[0].timestamp);
      const lastTimestamp = parseInt(filteredTransactions[filteredTransactions.length - 1].timestamp);
      const totalTimeSpan = lastTimestamp - firstTimestamp || 1;
      const position = ((timestamp - firstTimestamp) / totalTimeSpan) * 100;
      
      if (position >= 0 && position <= 100) {
        markers.push({
          year: currentDate.getFullYear(),
          position: Math.max(0, Math.min(100, position))
        });
      }
      
      currentDate.setFullYear(currentDate.getFullYear() + 1);
    }
    
    return markers;
  }, [filteredTransactions]);

  return (
    <div className={`transaction-timeline ${className}`}>
      {/* Filter controls */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => setFilterType('all')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
            filterType === 'all' 
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All ({transactions.length})
        </button>
        {transactionTypes.map(type => {
          const count = transactions.filter(t => t.type === type).length;
          return (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1 rounded-full text-sm font-medium capitalize transition-colors ${
                filterType === type
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {type.replace('_', ' ')} ({count})
            </button>
          );
        })}
      </div>

      {/* Zoom Controls */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setZoomLevel(Math.min(3, zoomLevel * 1.5))}
          className="p-1 text-gray-600 hover:text-gray-800"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={() => setZoomLevel(Math.max(0.5, zoomLevel / 1.5))}
          className="p-1 text-gray-600 hover:text-gray-800"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="text-xs text-gray-500">Zoom: {Math.round(zoomLevel * 100)}%</span>
      </div>

      {/* Timeline Container */}
      <div className="relative bg-gray-50 rounded-lg p-6" style={{ transform: `scaleX(${zoomLevel})`, transformOrigin: 'left' }}>
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No transactions found for the selected filter.
          </div>
        ) : (
          <>
            {/* Timeline Background */}
            <div className="relative h-16">
              {/* Main timeline line */}
              <div className="absolute top-8 left-0 right-0 h-0.5 bg-gray-300"></div>
              
              {/* Year markers */}
              {timeMarkers.map((marker, index) => (
                <div
                  key={index}
                  className="absolute transform -translate-x-1/2"
                  style={{ left: `${marker.position}%`, top: '20px' }}
                >
                  <div className="w-px h-4 bg-gray-400"></div>
                  <div className="text-xs text-gray-600 mt-1 transform -translate-x-1/2">
                    {marker.year}
                  </div>
                </div>
              ))}
              
              {/* Transaction markers */}
              {timelineData.map(({ transaction, position }, index) => (
                <TransactionMarker
                  key={transaction.id}
                  transaction={transaction}
                  position={position}
                  hoveredTransaction={hoveredTransaction}
                  onHover={setHoveredTransaction}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Legend</h4>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-blue-400"></div>
            <span>Players</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <span>Draft Picks</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
              <Shuffle className="h-2 w-2 text-white" />
            </div>
            <span>Trade</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
              <Users className="h-2 w-2 text-white" />
            </div>
            <span>Draft</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center">
              <TrendingUp className="h-2 w-2 text-white" />
            </div>
            <span>Waiver</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
              <UserPlus className="h-2 w-2 text-white" />
            </div>
            <span>Free Agent</span>
          </div>
        </div>
      </div>
    </div>
  );
};