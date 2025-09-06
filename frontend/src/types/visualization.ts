export enum NodeType {
  PLAYER = 'player',
  DRAFT_PICK = 'draft_pick',
  TRANSACTION = 'transaction'
}

export enum TransactionType {
  TRADE = 'trade',
  WAIVER = 'waiver',
  FREE_AGENT = 'free_agent',
  DRAFT = 'draft'
}

export enum LayoutType {
  FORCE_DIRECTED = 'force_directed',
  TREE_HORIZONTAL = 'tree_horizontal',
  TREE_VERTICAL = 'tree_vertical'
}

export interface D3Node {
  id: string;
  type: NodeType;
  name: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  
  // Player-specific
  position?: string;
  team?: string;
  sleeperId?: string;
  
  // Draft pick-specific
  season?: string;
  round?: number;
  pickNumber?: number;
  originalOwner?: string;
  currentOwner?: string;
  
  // Transaction-specific
  transactionType?: TransactionType;
  timestamp?: string;
  description?: string;
  participants?: string[];
  
  // Visual properties
  radius?: number;
  color?: string;
  strokeColor?: string;
  expanded?: boolean;
  
  // Relationships
  children?: D3Node[];
  parent?: D3Node;
}

export interface D3Link {
  id: string;
  source: string | D3Node;
  target: string | D3Node;
  transactionId?: string;
  transactionType?: TransactionType;
  timestamp?: string;
  description?: string;
  
  // Visual properties
  strokeWidth?: number;
  strokeColor?: string;
  animated?: boolean;
}

export interface VisualizationConfig {
  width: number;
  height: number;
  layout: LayoutType;
  
  // Node sizing
  minNodeRadius: number;
  maxNodeRadius: number;
  
  // Colors
  playerColor: string;
  draftPickColor: string;
  transactionColors: {
    trade: string;
    waiver: string;
    free_agent: string;
    draft: string;
  };
  
  // Interaction
  enableZoom: boolean;
  enableDrag: boolean;
  showTooltips: boolean;
  
  // Animation
  animationDuration: number;
  enableTransitions: boolean;
  
  // Force simulation (for force-directed layout)
  forceStrength: number;
  linkDistance: number;
  collisionRadius: number;
}

export interface TreeData {
  nodes: D3Node[];
  links: D3Link[];
  root?: D3Node;
}

export interface TooltipData {
  x: number;
  y: number;
  node: D3Node;
  visible: boolean;
}

export interface FilterOptions {
  seasons?: string[];
  transactionTypes?: TransactionType[];
  managers?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export const DEFAULT_VISUALIZATION_CONFIG: VisualizationConfig = {
  width: 800,
  height: 600,
  layout: LayoutType.FORCE_DIRECTED,
  
  minNodeRadius: 8,
  maxNodeRadius: 20,
  
  playerColor: '#3B82F6',
  draftPickColor: '#F59E0B',
  transactionColors: {
    trade: '#6366F1',
    waiver: '#F97316',
    free_agent: '#10B981',
    draft: '#8B5CF6'
  },
  
  enableZoom: true,
  enableDrag: true,
  showTooltips: true,
  
  animationDuration: 300,
  enableTransitions: true,
  
  forceStrength: -200,
  linkDistance: 100,
  collisionRadius: 25
};