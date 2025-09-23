import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AcquisitionTypeBadgeProps {
  type: string;
  className?: string;
}

export function AcquisitionTypeBadge({ type, className }: AcquisitionTypeBadgeProps) {
  const getTypeColor = (acquisitionType: string) => {
    switch (acquisitionType) {
      case 'draft':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
      case 'trade':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'free_agent_add':
      case 'waiver_add':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
      case 'original':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      case 'traded_pick':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const getDisplayText = (acquisitionType: string) => {
    switch (acquisitionType) {
      case 'free_agent_add':
        return 'FA';
      case 'waiver_add':
        return 'Waiver';
      case 'traded_pick':
        return 'Traded';
      default:
        return acquisitionType.charAt(0).toUpperCase() + acquisitionType.slice(1);
    }
  };

  return (
    <Badge
      variant="outline"
      className={cn(getTypeColor(type), className)}
    >
      {getDisplayText(type)}
    </Badge>
  );
}