import { useParams, Link } from 'react-router-dom';
import { Users, Calendar, TrendingUp, User, ArrowRight } from 'lucide-react';

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
        <h2 className="text-xl font-bold text-gray-900 mb-4">🎯 Test Transaction Chain Visualizations</h2>
        <p className="text-gray-600 mb-6">
          Click on a player below to see their complete transaction history with interactive D3.js visualizations:
        </p>
        
        <div className="grid gap-4">
          {/* Sample players for testing */}
          <Link 
            to="/player/cmf08zcgm014aohk4qeisup9r" 
            className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <div className="flex items-center">
              <User className="h-5 w-5 text-blue-600 mr-3" />
              <div>
                <h3 className="font-semibold text-gray-900">Travis Kelce</h3>
                <p className="text-sm text-gray-600">TE - Kansas City Chiefs</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
          </Link>

          <Link 
            to="/player/cmf08zc0a00lrohk4v4e152c9" 
            className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <div className="flex items-center">
              <User className="h-5 w-5 text-blue-600 mr-3" />
              <div>
                <h3 className="font-semibold text-gray-900">Jason Kelce</h3>
                <p className="text-sm text-gray-600">C - Philadelphia Eagles</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
          </Link>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
            <h4 className="font-semibold text-blue-900 mb-2">🔍 What you'll see:</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Interactive D3.js transaction tree visualization</li>
              <li>• Color-coded nodes: Players (blue), Draft Picks (yellow), Transactions (varied)</li>
              <li>• Zoom, pan, and drag functionality</li>
              <li>• Detailed tooltips on hover</li>
              <li>• Complete transaction history and trade chains</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}