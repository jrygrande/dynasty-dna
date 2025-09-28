import { cn } from '@/lib/utils';

interface PercentileBarProps {
  percentile: number;
  className?: string;
}

export function PercentileBar({ percentile, className }: PercentileBarProps) {
  // Handle null/no data case
  if (percentile === -1) {
    return (
      <div className={cn('space-y-1', className)}>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">-</span>
          <span className="text-muted-foreground">No data</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
          <div className="h-2 rounded-full bg-gray-300 dark:bg-gray-600" style={{ width: '100%' }} />
        </div>
      </div>
    );
  }

  const getPercentileColor = (value: number) => {
    if (value >= 90) return 'bg-green-500';      // Elite
    if (value >= 70) return 'bg-blue-500';       // Quality
    if (value >= 40) return 'bg-yellow-500';     // Average
    if (value >= 20) return 'bg-orange-500';     // Replacement
    return 'bg-red-500';                         // Disaster
  };

  const getPercentileLabel = (value: number) => {
    if (value >= 90) return 'Elite';
    if (value >= 70) return 'Quality';
    if (value >= 40) return 'Average';
    if (value >= 20) return 'Replacement';
    return 'Disaster';
  };

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex justify-between text-xs">
        <span>{percentile}th percentile</span>
        <span className="text-muted-foreground">{getPercentileLabel(percentile)}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
        <div
          className={cn(
            'h-2 rounded-full transition-all duration-300',
            getPercentileColor(percentile)
          )}
          style={{ width: `${percentile}%` }}
        />
      </div>
    </div>
  );
}