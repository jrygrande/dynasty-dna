import React, { useEffect, useRef, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { 
  D3Node, 
  D3Link, 
  TreeData, 
  VisualizationConfig, 
  DEFAULT_VISUALIZATION_CONFIG,
  NodeType,
  TransactionType,
  TooltipData,
  LayoutType
} from '../../types/visualization';

interface TransactionTreeVisualizationProps {
  data: TreeData;
  config?: Partial<VisualizationConfig>;
  onNodeClick?: (node: D3Node) => void;
  onNodeHover?: (node: D3Node | null) => void;
  className?: string;
}

export const TransactionTreeVisualization: React.FC<TransactionTreeVisualizationProps> = ({
  data,
  config: userConfig = {},
  onNodeClick,
  onNodeHover,
  className = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  
  const [tooltip, setTooltip] = useState<TooltipData>({
    x: 0,
    y: 0,
    node: {} as D3Node,
    visible: false
  });

  const config: VisualizationConfig = { ...DEFAULT_VISUALIZATION_CONFIG, ...userConfig };

  const getNodeColor = useCallback((node: D3Node): string => {
    if (node.type === NodeType.PLAYER) {
      return config.playerColor;
    }
    if (node.type === NodeType.DRAFT_PICK) {
      return config.draftPickColor;
    }
    if (node.type === NodeType.TRANSACTION) {
      return config.transactionColors[node.transactionType as TransactionType] || config.transactionColors.trade;
    }
    return '#6B7280';
  }, [config]);

  const getNodeRadius = useCallback((node: D3Node): number => {
    if (node.type === NodeType.TRANSACTION) {
      return config.minNodeRadius;
    }
    
    // Size players/picks based on importance (can be enhanced later)
    const baseRadius = node.type === NodeType.PLAYER ? config.maxNodeRadius * 0.8 : config.maxNodeRadius * 0.6;
    return Math.max(config.minNodeRadius, baseRadius);
  }, [config]);

  const showTooltip = useCallback((event: MouseEvent, node: D3Node) => {
    if (!config.showTooltips) return;
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setTooltip({
      x: event.clientX - rect.left + 10,
      y: event.clientY - rect.top - 10,
      node,
      visible: true
    });
  }, [config.showTooltips]);

  const hideTooltip = useCallback(() => {
    setTooltip(prev => ({ ...prev, visible: false }));
  }, []);

  const initializeVisualization = useCallback(() => {
    if (!svgRef.current || !data.nodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = config.width;
    const height = config.height;

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });

    if (config.enableZoom) {
      svg.call(zoom);
    }

    // Create main container
    const container = svg.append('g')
      .attr('class', 'visualization-container');

    // Create arrow markers for directed links
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 15)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#6B7280');

    // Initialize force simulation for force-directed layout
    if (config.layout === LayoutType.FORCE_DIRECTED) {
      simulationRef.current = d3.forceSimulation<D3Node>(data.nodes)
        .force('link', d3.forceLink<D3Node, D3Link>(data.links)
          .id((d: any) => d.id)
          .distance(config.linkDistance))
        .force('charge', d3.forceManyBody().strength(config.forceStrength))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius((d: any) => getNodeRadius(d) + config.collisionRadius));
    } else {
      // For tree layouts, use hierarchical positioning
      if (data.root) {
        const hierarchy = d3.hierarchy<D3Node>(data.root, d => d.children || []);
        const treeLayout = config.layout === LayoutType.TREE_HORIZONTAL
          ? d3.tree<D3Node>().size([height - 100, width - 100])
          : d3.tree<D3Node>().size([width - 100, height - 100]);
        
        treeLayout(hierarchy);
        
        hierarchy.descendants().forEach(d => {
          if (d.data) {
            d.data.x = config.layout === LayoutType.TREE_HORIZONTAL ? d.y! + 50 : d.x! + 50;
            d.data.y = config.layout === LayoutType.TREE_HORIZONTAL ? d.x! + 50 : d.y! + 50;
          }
        });
      }
    }

    // Create links
    const link = container.selectAll('.link')
      .data(data.links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', '#6B7280')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', 'url(#arrowhead)');

    // Create nodes
    const node = container.selectAll('.node')
      .data(data.nodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    // Add circles for nodes
    node.append('circle')
      .attr('r', d => getNodeRadius(d))
      .attr('fill', d => getNodeColor(d))
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 2);

    // Add text labels
    node.append('text')
      .text(d => d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .attr('fill', 'white')
      .attr('pointer-events', 'none');

    // Add interaction handlers
    node
      .on('click', (event, d) => {
        event.stopPropagation();
        onNodeClick?.(d);
      })
      .on('mouseover', (event, d) => {
        showTooltip(event, d);
        onNodeHover?.(d);
      })
      .on('mouseout', () => {
        hideTooltip();
        onNodeHover?.(null);
      });

    // Add drag behavior if enabled
    if (config.enableDrag && simulationRef.current) {
      const drag = d3.drag<SVGGElement, D3Node>()
        .on('start', (event, d) => {
          if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });

      (node as any).call(drag);
    }

    // Update positions during simulation
    if (simulationRef.current) {
      simulationRef.current.on('tick', () => {
        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);

        node
          .attr('transform', d => `translate(${d.x},${d.y})`);
      });
    } else {
      // For non-force layouts, position immediately
      link
        .attr('x1', (d: any) => {
          const sourceNode = data.nodes.find(n => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
          return sourceNode?.x || 0;
        })
        .attr('y1', (d: any) => {
          const sourceNode = data.nodes.find(n => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
          return sourceNode?.y || 0;
        })
        .attr('x2', (d: any) => {
          const targetNode = data.nodes.find(n => n.id === (typeof d.target === 'string' ? d.target : d.target.id));
          return targetNode?.x || 0;
        })
        .attr('y2', (d: any) => {
          const targetNode = data.nodes.find(n => n.id === (typeof d.target === 'string' ? d.target : d.target.id));
          return targetNode?.y || 0;
        });

      node
        .attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    }

  }, [data, config, getNodeColor, getNodeRadius, onNodeClick, onNodeHover, showTooltip, hideTooltip]);

  useEffect(() => {
    initializeVisualization();

    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [initializeVisualization]);

  const renderTooltip = () => {
    if (!tooltip.visible) return null;

    const { node } = tooltip;
    
    return (
      <div
        className="absolute bg-gray-900 text-white p-3 rounded-lg shadow-lg z-10 max-w-xs"
        style={{
          left: tooltip.x,
          top: tooltip.y,
          pointerEvents: 'none'
        }}
      >
        <div className="font-bold text-sm mb-1">{node.name}</div>
        <div className="text-xs text-gray-300">
          {node.type === NodeType.PLAYER && (
            <>
              <div>Position: {node.position || 'Unknown'}</div>
              <div>Team: {node.team || 'Unknown'}</div>
            </>
          )}
          {node.type === NodeType.DRAFT_PICK && (
            <>
              <div>Season: {node.season}</div>
              <div>Round: {node.round}</div>
              {node.pickNumber && <div>Pick #{node.pickNumber}</div>}
            </>
          )}
          {node.type === NodeType.TRANSACTION && (
            <>
              <div>Type: {node.transactionType}</div>
              {node.timestamp && <div>Date: {new Date(node.timestamp).toLocaleDateString()}</div>}
              <div>{node.description}</div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <svg
        ref={svgRef}
        width={config.width}
        height={config.height}
        className="border border-gray-200 rounded-lg bg-white"
      />
      {renderTooltip()}
    </div>
  );
};