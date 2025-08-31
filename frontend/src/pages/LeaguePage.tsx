import { useParams } from 'react-router-dom';
import { Users, Calendar, TrendingUp } from 'lucide-react';

export function LeaguePage() {
  const { leagueId } = useParams<{ leagueId: string }>();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          League Analysis
        </h1>
        <p className="text-gray-600">
          League ID: {leagueId}
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-dynasty-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Managers</h3>
              <p className="text-gray-600">-</p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-dynasty-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Season</h3>
              <p className="text-gray-600">-</p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <TrendingUp className="h-8 w-8 text-dynasty-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Total Trades</h3>
              <p className="text-gray-600">-</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Coming Soon</h2>
        <p className="text-gray-600">
          League data visualization will be available once the Sleeper API integration is complete.
          This page will show transaction chains, roster analysis, and manager profiles.
        </p>
      </div>
    </div>
  );
}