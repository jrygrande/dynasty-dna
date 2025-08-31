import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="text-center">
      <div className="card max-w-md mx-auto">
        <h1 className="text-6xl font-bold text-dynasty-600 mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Page Not Found
        </h2>
        <p className="text-gray-600 mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/" className="btn-primary inline-flex items-center justify-center">
            <Home className="h-4 w-4 mr-2" />
            Go Home
          </Link>
          <button 
            onClick={() => window.history.back()} 
            className="btn-secondary inline-flex items-center justify-center"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}