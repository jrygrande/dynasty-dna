#!/bin/bash
# Setup GitHub labels and seed initial roadmap issues for Dynasty DNA.
#
# Prerequisites: gh CLI authenticated (gh auth login)
# Usage: ./scripts/setup-roadmap.sh

set -euo pipefail

REPO="jrygrande/dynasty-dna"

echo "=== Creating labels ==="

# Status labels
gh label create "status:shipped" --color "2ea44f" --description "Feature is live in production" --repo "$REPO" --force
gh label create "status:in-progress" --color "1f6feb" --description "Actively being worked on" --repo "$REPO" --force
gh label create "status:planned" --color "d29922" --description "Committed to building" --repo "$REPO" --force
gh label create "status:exploring" --color "a371f7" --description "Researching / validating approach" --repo "$REPO" --force

# Phase labels
gh label create "phase:1" --color "bfdadc" --description "Phase 1: Foundation" --repo "$REPO" --force
gh label create "phase:2" --color "bfdadc" --description "Phase 2: Data Foundation" --repo "$REPO" --force
gh label create "phase:3" --color "bfdadc" --description "Phase 3: NFL Data & Player Insights" --repo "$REPO" --force
gh label create "phase:4" --color "bfdadc" --description "Phase 4: Manager Analytics" --repo "$REPO" --force
gh label create "phase:5" --color "bfdadc" --description "Phase 5: Asset Graph & Exploration" --repo "$REPO" --force
gh label create "phase:6" --color "bfdadc" --description "Phase 6: Polish & Advanced" --repo "$REPO" --force

# Priority labels
gh label create "priority:p0" --color "d73a4a" --description "Must have" --repo "$REPO" --force
gh label create "priority:p1" --color "e4e669" --description "Should have" --repo "$REPO" --force
gh label create "priority:p2" --color "0e8a16" --description "Nice to have" --repo "$REPO" --force

# Type labels
gh label create "type:feature" --color "0075ca" --description "New feature or enhancement" --repo "$REPO" --force
gh label create "type:experiment" --color "a371f7" --description "A/B test or experiment" --repo "$REPO" --force
gh label create "type:bug" --color "d73a4a" --description "Bug report" --repo "$REPO" --force

# Roadmap meta label
gh label create "roadmap" --color "006b75" --description "Appears on public roadmap" --repo "$REPO" --force

echo ""
echo "=== Creating roadmap issues ==="

# --- SHIPPED (Phases 1-3) ---

gh issue create --repo "$REPO" --title "Foundation: Auth, Sleeper Integration, League Discovery" \
  --label "roadmap,type:feature,status:shipped,phase:1,priority:p0" \
  --body "$(cat <<'BODY'
### Problem Statement
Dynasty managers need a way to connect their Sleeper leagues and view their data in a more analytical format.

### Hypothesis
If we provide seamless OAuth + Sleeper account linking, managers will connect their leagues within 2 minutes of signing up, creating the data foundation for all analytics features.

### Approach
- NextAuth.js with GitHub/Google OAuth
- Sleeper username linking flow
- League family stitching (chain previous_league_id across seasons)
- On-demand sync on first league visit

### Success Metrics
- Time from sign-in to first league view < 2 minutes
- Successful Sleeper link rate > 90%

### Tradeoffs
- JWT sessions over DB sessions: faster auth checks, no session table, but can't revoke server-side. Acceptable for this use case.
- Lazy sync over eager pre-fetch: users wait a few seconds on first load, but avoids background job infrastructure.
BODY
)" && echo "Created: Foundation"

gh issue create --repo "$REPO" --title "Historical League Sync & Transaction Log" \
  --label "roadmap,type:feature,status:shipped,phase:2,priority:p0" \
  --body "$(cat <<'BODY'
### Problem Statement
Dynasty leagues span multiple seasons. Managers need to see their full history, not just the current season.

### Hypothesis
Showing full dynasty history (all seasons, all transactions) will increase engagement because managers can trace how their roster evolved over time.

### Approach
- Sync all seasons in a dynasty family via previous_league_id chain
- 7-day staleness check for completed seasons
- Transaction log with season/type filters and pagination
- Asset event pipeline for denormalized movement tracking

### Success Metrics
- Average sessions per user per week
- % of users who view transactions from prior seasons
BODY
)" && echo "Created: Historical Sync"

gh issue create --repo "$REPO" --title "Draft History Visualization" \
  --label "roadmap,type:feature,status:shipped,phase:2,priority:p1" \
  --body "$(cat <<'BODY'
### Problem Statement
Managers want to review their draft decisions across seasons to understand their drafting tendencies and outcomes.

### Hypothesis
A visual draft board (rounds x teams grid with position-coded badges) will help managers identify their drafting patterns more effectively than a text list.

### Approach
- Draft board grid with position-coded player badges
- Keeper indicators
- Multi-season viewing with season selector

### Success Metrics
- Time spent on draft page per visit
- Cross-season navigation rate
BODY
)" && echo "Created: Draft History"

gh issue create --repo "$REPO" --title "NFL Data Integration (Roster Status, Injuries, Schedule)" \
  --label "roadmap,type:feature,status:shipped,phase:3,priority:p0" \
  --body "$(cat <<'BODY'
### Problem Statement
Fantasy data alone doesn't tell the full story. Managers need NFL context (injuries, roster status, bye weeks) to understand lineup decisions.

### Hypothesis
Integrating NFL roster status and injury data will make lineup analysis 3x more useful because managers can see *why* a player was benched (injured, bye, cut) vs. a bad decision.

### Approach
- nflverse weekly roster status sync (ACT/RES/INA/DEV/CUT)
- nflverse injury data sync
- NFL schedule for bye week derivation
- Player ID crosswalk (sleeper_id <-> gsis_id)

### Success Metrics
- % of lineup decisions that can be contextualized with NFL status
- Reduction in "false positive" bad lineup grades

### Tradeoffs
- nflverse CSV files over NFL API: free, no auth needed, comprehensive historical data
- Self-healing crosswalk: each sync backfills missing gsis_id values
BODY
)" && echo "Created: NFL Data"

gh issue create --repo "$REPO" --title "Player Detail Pages with Weekly Performance Log" \
  --label "roadmap,type:feature,status:shipped,phase:3,priority:p0" \
  --body "$(cat <<'BODY'
### Problem Statement
Managers need a deep-dive view of individual players showing their week-by-week performance, ownership history, and lineup decisions.

### Hypothesis
A combined view of weekly points + NFL status + lineup slot will help managers understand player value trajectory, leading to more informed trade decisions.

### Approach
- Weekly log showing points, lineup slot, NFL status per week
- Ownership timeline across seasons
- Filters: season, manager, started/benched
- Summary stats: weeks rostered, started, benched, PPG

### Success Metrics
- Player page views per session
- Navigation from player page to trade/transaction pages
BODY
)" && echo "Created: Player Detail"

# Close the shipped issues
echo ""
echo "=== Closing shipped issues ==="
for issue_num in $(gh issue list --repo "$REPO" --label "status:shipped" --json number --jq '.[].number'); do
  gh issue close "$issue_num" --repo "$REPO" 2>/dev/null || true
  echo "Closed #$issue_num"
done

# --- IN PROGRESS (Phase 4) ---

gh issue create --repo "$REPO" --title "Lineup Optimization Score" \
  --label "roadmap,type:feature,status:in-progress,phase:4,priority:p0" \
  --body "$(cat <<'BODY'
### Problem Statement
Managers don't know how much they're leaving on the table each week by not setting the optimal lineup.

### Hypothesis
Managers who see their optimal-vs-actual lineup gap will make better start/sit decisions, measurable by a 5% reduction in bench points over 4 weeks of awareness.

### Approach
- Calculate optimal lineup per week using actual player scores
- Compare to actual lineup set by manager
- Generate weekly and season-level efficiency scores (A+ to F)
- Surface on league overview and manager profile

### Success Metrics
- % of weeks with optimal lineup set (pre vs post feature)
- Average points left on bench per week
- Return visit rate to lineup efficiency page

### Tradeoffs
- Retrospective only (not predictive): we grade based on actual outcomes, not projections. This is more defensible and doesn't require projection data.
- Position-slot matching: we respect the league's lineup settings (superflex, TE premium, etc.)
BODY
)" && echo "Created: Lineup Optimization"

gh issue create --repo "$REPO" --title "Trade Grading with Production & Value Analysis" \
  --label "roadmap,type:feature,status:in-progress,phase:4,priority:p0" \
  --body "$(cat <<'BODY'
### Problem Statement
Managers make trades but have no objective measure of whether a trade was good or bad in hindsight.

### Hypothesis
Showing trade value delta (what you got vs. what you gave up) with adaptive production/value weighting will help managers learn from past trades and make better future decisions.

### Approach
- Post-trade production comparison (points scored by acquired vs. traded players)
- FantasyCalc dynasty value comparison at trade time
- Adaptive weighting: more production weight when players have game data, more value weight for recent trades
- Grade scale: A+ to F with context labels

### Success Metrics
- Engagement with trade detail pages
- Cross-referencing trades with player performance pages
BODY
)" && echo "Created: Trade Grading"

# --- PLANNED (Phase 4) ---

gh issue create --repo "$REPO" --title "Manager DNA Profile (Composite Score)" \
  --label "roadmap,type:feature,status:planned,phase:4,priority:p1" \
  --body "$(cat <<'BODY'
### Problem Statement
Managers have individual analytics (lineup, trade, draft grades) but no single view that captures their overall management style and quality.

### Hypothesis
A single composite "DNA score" will increase engagement with individual analytics features by giving managers a headline number to improve.

### Approach
- Weighted composite of lineup efficiency, trade grades, draft grades, waiver/FA success
- Percentile ranking within the league
- Historical tracking: how has a manager's DNA evolved over seasons?
- Visual DNA profile with dimension breakdown

### Success Metrics
- Weekly return rate to manager profile
- Cross-feature navigation (lineup -> trades -> drafts)
- Share rate of DNA profiles
BODY
)" && echo "Created: Manager DNA"

gh issue create --repo "$REPO" --title "Draft Grading (Pick Value vs. Performance)" \
  --label "roadmap,type:feature,status:planned,phase:4,priority:p1" \
  --body "$(cat <<'BODY'
### Problem Statement
Managers want to know if they're drafting well relative to their pick position and league-mates.

### Hypothesis
Comparing draft pick value (expected outcome for that slot) vs. actual player performance will reveal drafting skill vs. luck, leading managers to adjust their draft strategy.

### Approach
- Historical pick value curves by position and round
- Compare actual player output to expected output for draft slot
- Grade drafts at the individual pick and overall level

### Success Metrics
- Draft page engagement (time on page, return visits)
- Correlation between draft grade awareness and next-season draft performance
BODY
)" && echo "Created: Draft Grading"

# --- EXPLORING (Phases 5-6) ---

gh issue create --repo "$REPO" --title "Asset Graph Browser" \
  --label "roadmap,type:feature,status:exploring,phase:5,priority:p2" \
  --body "$(cat <<'BODY'
### Problem Statement
The flow of players and picks through a dynasty league forms a complex network. Transaction logs show individual events but don't reveal the broader patterns.

### Hypothesis
Visualizing the network of trades as an interactive graph will surface non-obvious patterns (e.g., one manager is the hub of all trades) that managers find more insightful than a transaction log.

### Approach
- Interactive node-link diagram of asset movements
- Players and picks as nodes, transactions as edges
- Filterable by time range, manager, asset type
- Hover for details, click to navigate

### Success Metrics
- Discovery of multi-hop trade chains
- Share rate of graph visualizations
- Qualitative feedback on "aha moments"

### Open Questions
- What graph library? D3.js, Cytoscape, React Flow?
- Performance with large trade histories (100+ transactions)?
BODY
)" && echo "Created: Asset Graph"

gh issue create --repo "$REPO" --title "\"What If\" Counterfactual Trade Analysis" \
  --label "roadmap,type:feature,status:exploring,phase:5,priority:p2" \
  --body "$(cat <<'BODY'
### Problem Statement
Managers wonder "what if I hadn't made that trade?" but have no way to explore the counterfactual.

### Hypothesis
Counterfactual analysis ("what if you kept Player X instead of trading for Player Y?") will create stronger emotional engagement with trade history because it taps into the natural human tendency to evaluate alternatives.

### Approach
- For each trade, show the alternate timeline: your roster if the trade never happened
- Compare actual vs. counterfactual season performance
- Highlight trades that clearly helped or hurt

### Success Metrics
- Time spent on trade analysis pages
- Return visit rate to counterfactual views
BODY
)" && echo "Created: Counterfactual"

gh issue create --repo "$REPO" --title "Mobile Responsive Design" \
  --label "roadmap,type:feature,status:planned,phase:6,priority:p2" \
  --body "$(cat <<'BODY'
### Problem Statement
Many fantasy football managers primarily access their leagues on mobile, but the current UI is desktop-optimized.

### Hypothesis
Mobile-responsive design will increase session frequency because managers can check their analytics on the go (commuting, during games, etc.).

### Approach
- Responsive breakpoints for all existing pages
- Touch-friendly interactions
- Simplified layouts for narrow screens
- Priority: league overview, lineup grades, transactions

### Success Metrics
- Mobile session share (target: >40% of sessions)
- Mobile session duration vs. desktop
BODY
)" && echo "Created: Mobile Responsive"

gh issue create --repo "$REPO" --title "FantasyCalc Integration for Dynasty Valuations" \
  --label "roadmap,type:feature,status:planned,phase:6,priority:p1" \
  --body "$(cat <<'BODY'
### Problem Statement
Trade grading currently uses only retrospective production data. Managers also want to know trade value using forward-looking dynasty consensus values.

### Hypothesis
Adding FantasyCalc dynasty values to trade analysis will make trade grades more credible for recent trades where production data is limited.

### Approach
- Sync dynasty player values from FantasyCalc API
- Blend FantasyCalc values with production data in trade grades
- Show value trends over time on player detail pages

### Success Metrics
- Trust in trade grades (qualitative)
- Trade grade page engagement for recent trades
BODY
)" && echo "Created: FantasyCalc"

echo ""
echo "=== Done! ==="
echo "View your roadmap at: https://github.com/$REPO/issues?q=label%3Aroadmap"
