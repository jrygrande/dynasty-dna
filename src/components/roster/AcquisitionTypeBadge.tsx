import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AcquisitionTypeBadgeProps {
  type: string;
  className?: string;
}

export function AcquisitionTypeBadge({ type, className }: AcquisitionTypeBadgeProps) {
  const getTypeColor = (acquisitionType: string) => {
    switch (acquisitionType) {
      case 'draft_selected':
      case 'draft':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'trade':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'free_agency':
      case 'free_agent_add':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'waiver_add':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
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
      case 'draft_selected':
        return 'Draft';
      case 'free_agency':
      case 'free_agent_add':
        return 'Free Agency';
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