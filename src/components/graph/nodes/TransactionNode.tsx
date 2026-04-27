"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { useGraphHover } from "../AssetGraph";
import {
  TransactionCardChrome,
  type TransactionCardChromeData,
} from "../TransactionCardChrome";

export type TransactionNodeData = TransactionCardChromeData;

function TransactionNodeImpl({ id, data, selected }: NodeProps<TransactionNodeData>) {
  const { hoveredAssetKey, setHoveredAssetKey } = useGraphHover();
  const isSelected = selected || data.selected || false;

  return (
    <TransactionCardChrome
      nodeId={id}
      data={data}
      isSelected={isSelected}
      hoveredAssetKey={hoveredAssetKey}
      onAssetHover={setHoveredAssetKey}
      handles={
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="card-target"
            className="!bg-transparent !border-0"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="card-source"
            className="!bg-transparent !border-0"
          />
        </>
      }
      renderAssetHandles={(assetKey) =>
        data.expandedAssets.has(assetKey) ? (
          <>
            <Handle
              type="target"
              position={Position.Left}
              id={`asset-target-${assetKey}`}
              className="!w-px !h-px !opacity-0 !border-0 !min-w-0 !min-h-0"
            />
            <Handle
              type="source"
              position={Position.Right}
              id={`asset-source-${assetKey}`}
              className="!w-px !h-px !opacity-0 !border-0 !min-w-0 !min-h-0"
            />
          </>
        ) : null
      }
    />
  );
}

export const TransactionNode = memo(TransactionNodeImpl);
TransactionNode.displayName = "TransactionNode";
