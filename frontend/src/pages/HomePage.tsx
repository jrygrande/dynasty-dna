import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, TrendingUp, Users, GitBranch } from 'lucide-react';

export function HomePage() {
  const [leagueId, setLeagueId] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (leagueId.trim()) {
      navigate(`/league/${leagueId.trim()}`);
    }
  };

  const features = [
    {
      icon: GitBranch,
      title: 'Transaction Chains',
      description: 'Trace the complete history of how players and picks moved through your league',
    },
    {
      icon: TrendingUp,
      title: 'Performance Tracking',
      description: 'Analyze player performance during their time on each roster',
    },
    {
      icon: Users,
      title: 'Manager Analysis',
      description: 'See how each player was acquired and their roster construction history',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Dynasty DNA
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Trace the genetic makeup of your dynasty fantasy football team through trade chains and roster decisions
        </p>
        
        <form onSubmit={handleSearch} className="max-w-md mx-auto">
          <div className="flex">
            <input
              type="text"
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              placeholder="Enter Sleeper League ID"
              className="input rounded-r-none"
            />
            <button
              type="submit"
              className="btn-primary rounded-l-none"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Try the test league: 1191596293294166016
          </p>
        </form>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div key={index} className="card text-center">
              <div className="flex justify-center mb-4">
                <Icon className="h-12 w-12 text-dynasty-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-gray-600">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-12 card">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Getting Started</h2>
        <div className="space-y-4 text-gray-700">
          <div className="flex items-start">
            <div className="flex-shrink-0 w-8 h-8 bg-dynasty-100 text-dynasty-700 rounded-full flex items-center justify-center text-sm font-medium mr-3">
              1
            </div>
            <div>
              <h3 className="font-medium">Find your Sleeper League ID</h3>
              <p className="text-sm text-gray-600">Go to your league on Sleeper and copy the numeric ID from the URL</p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="flex-shrink-0 w-8 h-8 bg-dynasty-100 text-dynasty-700 rounded-full flex items-center justify-center text-sm font-medium mr-3">
              2
            </div>
            <div>
              <h3 className="font-medium">Enter the League ID above</h3>
              <p className="text-sm text-gray-600">Dynasty DNA will analyze your league's transaction history</p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="flex-shrink-0 w-8 h-8 bg-dynasty-100 text-dynasty-700 rounded-full flex items-center justify-center text-sm font-medium mr-3">
              3
            </div>
            <div>
              <h3 className="font-medium">Explore your dynasty's DNA</h3>
              <p className="text-sm text-gray-600">Click on any player or trade to see their complete transaction chain</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}