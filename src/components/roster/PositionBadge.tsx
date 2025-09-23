import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PositionBadgeProps {
  position: string | null;
  className?: string;
}

export function PositionBadge({ position, className }: PositionBadgeProps) {
  if (!position) return null;

  const getPositionColor = (pos: string) => {
    switch (pos.toUpperCase()) {
      case 'QB':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'RB':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'WR':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'TE':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'K':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'DEF':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  return (
    <Badge
      variant="secondary"
      className={cn(getPositionColor(position), className)}
    >
      {position}
    </Badge>
  );
}