'use client';

import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Users, FileText } from 'lucide-react';
import type { AssetNodeData } from '@/lib/utils/graph';

interface AssetNodeProps {
    data: AssetNodeData;
    selected?: boolean;
}

function AssetNode({ data, selected }: AssetNodeProps) {
    const isPlayer = data.assetKind === 'player';

    return (
        <>
            <Handle type="target" position={Position.Left} className="w-3 h-3" />
            <Card
                className={`px-4 py-3 min-w-[180px] transition-all cursor-pointer ${selected
                        ? 'ring-2 ring-blue-500 shadow-lg bg-blue-50'
                        : 'shadow-md hover:shadow-lg hover:bg-slate-50'
                    }`}
            >
                <div className="flex items-center gap-3">
                    <div
                        className={`w-10 h-10 rounded-lg ${isPlayer ? 'bg-emerald-100' : 'bg-purple-100'
                            } flex items-center justify-center`}
                    >
                        {isPlayer ? (
                            <Users className="w-5 h-5 text-emerald-600" />
                        ) : (
                            <FileText className="w-5 h-5 text-purple-600" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{data.name}</div>
                        {isPlayer && (data.position || data.team) && (
                            <div className="flex gap-1 mt-1">
                                {data.position && (
                                    <Badge variant="secondary" className="text-xs">
                                        {data.position}
                                    </Badge>
                                )}
                                {data.team && (
                                    <Badge variant="outline" className="text-xs">
                                        {data.team}
                                    </Badge>
                                )}
                            </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                            {data.transactionIds.length} event{data.transactionIds.length !== 1 ? 's' : ''}
                        </div>
                    </div>
                </div>
            </Card>
            <Handle type="source" position={Position.Right} className="w-3 h-3" />
        </>
    );
}

export default memo(AssetNode);
