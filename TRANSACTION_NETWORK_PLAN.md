# Player Transaction Network Visualization - Degrees of Separation Plan

## Overview
Create a focused, expandable visualization that starts with a single player's direct transactions and allows users to progressively reveal connected transactions through a "degrees of separation" control.

## Current Issue
The existing player visualization approach using asset-tree endpoints has data structure mismatches and API issues. Instead, we'll use the working `transaction-graph` endpoint and build a player-centric filtering system.

## Data Understanding (Travis Kelce Example)
**Corrected Transaction Flow:**
- Travis Kelce was drafted by jrygrande
- Later: Travis Kelce traded FROM jrygrande TO Acruz
- jrygrande received: Pat Freiermuth + 2023 R1 Pick + 2024 R1 Pick
- Acruz received: Travis Kelce

## Key Changes Needed

### 1. Update PlayerPage Component
- **Remove** complex asset tree endpoint calls that aren't working
- **Add** player name search/selection input
- **Add** "Network Depth" slider (1-5 degrees)
- **Fetch** transaction-graph endpoint (which we know works: `http://localhost:3001/api/leagues/1191596293294166016/transaction-graph`)
- **Filter** transactions based on selected player and depth

### 2. Create New Filtering Algorithm
**File:** `frontend/src/utils/transactionNetworkFilter.ts`
- `getPlayerTransactions(graph, playerId, depth)` - Main filtering function
- **Depth 1:** Only transactions directly involving the player
- **Depth 2:** Add transactions involving any assets from depth 1 transactions  
- **Depth 3+:** Continue expanding to connected transactions
- Return filtered nodes and transactions for visualization

**Algorithm Logic:**
1. Start with focal player
2. Find all transactions involving that player
3. For each depth level, collect all assets from previous transactions
4. Find new transactions involving those assets
5. Continue until desired depth reached

### 3. Update Visualization Component
- Modify D3.js visualization to highlight the focal player
- Show transaction flow with directional arrows
- Color code by depth level (darker = closer to player)
- Size nodes based on importance/centrality
- Position focal player at center

### 4. UI Components to Add
- **Player Search Bar:** Autocomplete search by player name
- **Network Depth Control:** Slider with labels:
  - 1 = "Direct Transactions"
  - 2 = "One Degree Out" 
  - 3 = "Two Degrees Out"
  - etc.
- **Stats Panel:** Show counts of transactions/assets at each depth
- **Legend:** Explain node types and depth coloring
- **Transaction Details:** Show transaction descriptions on hover/click

### 5. Working Data Structure (from API)
```json
{
  "graph": {
    "nodes": [{"id": "...", "name": "Travis Kelce", "type": "player", ...}],
    "transactions": [
      {
        "type": "trade",
        "description": "Trade between jrygrande and Acruz1215", 
        "managerFrom": {"username": "jrygrande"},
        "managerTo": {"username": "Acruz1215"},
        "assetsGiven": [{"name": "Travis Kelce", "type": "player"}],
        "assetsReceived": [
          {"name": "Pat Freiermuth", "type": "player"},
          {"name": "2023 Round 1 Pick", "type": "draft_pick"},
          {"name": "2024 Round 1 Pick", "type": "draft_pick"}
        ]
      }
    ]
  }
}
```

## Implementation Steps

1. **Simplify data fetching** - Use only the working transaction-graph endpoint
2. **Create player search** - Find player by name in nodes array
3. **Build depth filtering** - Implement breadth-first search for connected transactions
4. **Update visualization** - Focus on selected player with expandable network
5. **Add interactive controls** - Slider for depth, search for players
6. **Polish UX** - Smooth transitions when changing depth

## Example User Flow
1. User enters "Travis Kelce" in search
2. **Depth 1** visualization shows:
   - Travis Kelce node (highlighted center)
   - Draft transaction (startup draft by jrygrande)
   - Trade transaction (Kelce to Acruz for Freiermuth + 2 picks)
3. User slides depth to **2**
4. Visualization expands to show:
   - What happened with Pat Freiermuth after the trade
   - What jrygrande did with those 2023/2024 R1 draft picks
   - Any subsequent trades involving those assets
5. **Depth 3+** continues the chain further out

## Technical Benefits
- Uses the **working** transaction-graph endpoint 
- Simpler data structure (arrays instead of complex Maps)
- Progressive disclosure reduces cognitive load
- Focused on single player makes stories clearer
- Expandable network allows deep exploration

## UI/UX Benefits  
- Clear starting point (search for any player)
- Intuitive depth control (like LinkedIn connections)
- Progressive revelation keeps visualization manageable
- Focused storytelling around specific players
- Easy to understand transaction flow direction