import { cn } from '@/lib/utils';

interface PercentileBarProps {
  percentile: number;
  className?: string;
}

export function PercentileBar({ percentile, className }: PercentileBarProps) {
  const getPercentileColor = (value: number) => {
    if (value >= 80) return 'bg-green-500';
    if (value >= 60) return 'bg-blue-500';
    if (value >= 40) return 'bg-yellow-500';
    if (value >= 20) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getPercentileLabel = (value: number) => {
    if (value >= 90) return 'Elite';
    if (value >= 75) return 'Good';
    if (value >= 50) return 'Average';
    if (value >= 25) return 'Below Avg';
    return 'Poor';
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