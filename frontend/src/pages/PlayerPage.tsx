import { useParams } from 'react-router-dom';
import { User, Calendar, GitBranch } from 'lucide-react';

export function PlayerPage() {
  const { playerId } = useParams<{ playerId: string }>();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Player Transaction Chain
        </h1>
        <p className="text-gray-600">
          Player ID: {playerId}
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center">
            <User className="h-8 w-8 text-dynasty-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Player Name</h3>
              <p className="text-gray-600">-</p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-dynasty-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Current Team</h3>
              <p className="text-gray-600">-</p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <GitBranch className="h-8 w-8 text-dynasty-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Total Trades</h3>
              <p className="text-gray-600">-</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Transaction Chain Visualization</h2>
        <p className="text-gray-600">
          Player transaction chain visualization will be available once the Sleeper API integration 
          and D3.js transaction tree component are complete.
        </p>
      </div>
    </div>
  );
}