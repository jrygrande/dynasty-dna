'use client';

import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { TransactionNodeData } from '@/lib/utils/graph';

interface TransactionNodeProps {
    data: TransactionNodeData;
    selected?: boolean;
}

const formatDate = (dateString: string | null): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
};

const getEventTypeLabel = (eventType: string): string => {
    const labels: Record<string, string> = {
        trade: 'Trade',
        pick_trade: 'Pick Trade',
        draft_selected: 'Draft',
        pick_selected: 'Pick Used',
        waiver_add: 'Waiver',
        waiver_drop: 'Drop',
        free_agent_add: 'FA Add',
        free_agent_drop: 'FA Drop',
    };
    return labels[eventType] || eventType;
};

const getEventTypeColor = (eventType: string): string => {
    const colors: Record<string, string> = {
        trade: 'bg-blue-500',
        pick_trade: 'bg-purple-500',
        draft_selected: 'bg-green-500',
        pick_selected: 'bg-emerald-500',
        waiver_add: 'bg-orange-500',
        waiver_drop: 'bg-red-500',
        free_agent_add: 'bg-yellow-500',
        free_agent_drop: 'bg-gray-500',
    };
    return colors[eventType] || 'bg-slate-500';
};

function TransactionNode({ data, selected }: TransactionNodeProps) {
    const eventLabel = getEventTypeLabel(data.eventType);
    const eventColor = getEventTypeColor(data.eventType);

    return (
        <>
            <Handle type="target" position={Position.Left} className="w-3 h-3" />
            <Card
                className={`px-4 py-3 min-w-[140px] transition-all ${selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-md hover:shadow-lg'
                    }`}
            >
                <div className="flex flex-col items-center gap-2">
                    <div
                        className={`w-12 h-12 rounded-full ${eventColor} flex items-center justify-center text-white font-bold text-sm`}
                    >
                        {eventLabel.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="text-xs font-semibold text-center">{eventLabel}</div>
                    {data.season && (
                        <Badge variant="outline" className="text-xs">
                            {data.season} W{data.week || 0}
                        </Badge>
                    )}
                    {data.eventTime && (
                        <div className="text-xs text-muted-foreground text-center">
                            {formatDate(data.eventTime)}
                        </div>
                    )}
                </div>
            </Card>
            <Handle type="source" position={Position.Right} className="w-3 h-3" />
        </>
    );
}

export default memo(TransactionNode);
