'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface SeasonOption {
  value: string;
  label: string;
  description?: string;
}

interface SeasonSelectorProps {
  seasons: SeasonOption[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SeasonSelector({ seasons, value, onValueChange, className }: SeasonSelectorProps) {
  if (seasons.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Select season" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-time">All-Time</SelectItem>
          {seasons.map((season) => (
            <SelectItem key={season.value} value={season.value}>
              <div className="flex flex-col">
                <span>{season.label}</span>
                {season.description && (
                  <span className="text-xs text-muted-foreground">{season.description}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}