# Dynasty DNA API Documentation

Base URL: `http://localhost:3001`

## Testing & Health Endpoints

### GET /api/test/api-status
Check Sleeper API connectivity and performance.

**Example:**
```bash
curl http://localhost:3001/api/test/api-status
```

**Response:**
```json
{
  "status": "healthy",
  "apiConnection": "success",
  "apiCallTime": "170ms",
  "rateLimitTestTime": "210ms",
  "cacheStats": { "hits": 0, "misses": 0, "keys": 3 },
  "nflState": { "season": "2025", "week": 1, "seasonType": "regular" },
  "timestamp": "2025-08-31T22:13:38.610Z"
}
```

### GET /api/test/database-stats
Get database health and record counts.

### POST /api/test/sync-test-league
Sync the Dynasty Domination test league.

### POST /api/test/sync-dynasty-history
Sync complete dynasty history for test league.

## Core League Endpoints

### POST /api/leagues/:leagueId/sync
Sync a specific league from Sleeper API.

**Example:**
```bash
curl -X POST http://localhost:3001/api/leagues/1191596293294166016/sync
```

### GET /api/leagues/:leagueId
Get league details (database first, fallback to API).

### GET /api/leagues/:leagueId/transactions
Get paginated transaction history.

**Parameters:**
- `limit` - Number of transactions (default: 50)
- `offset` - Pagination offset (default: 0)  
- `type` - Filter by type: 'trade', 'waiver', 'free_agent'

**Example:**
```bash
curl "http://localhost:3001/api/leagues/1191596293294166016/transactions?type=trade&limit=10"
```

**Response:**
```json
{
  "leagueId": "1191596293294166016",
  "leagueName": "Dynasty Domination",
  "transactions": [
    {
      "id": "cmf08zke70930ohk4hnqe3e6c",
      "sleeperTransactionId": "1240509436661858304",
      "type": "trade",
      "status": "complete",
      "week": 1,
      "timestamp": "1750128694014",
      "items": [
        {
          "type": "add",
          "player": {
            "sleeperId": "9229",
            "fullName": "Anthony Richardson",
            "position": "QB",
            "team": "IND"
          },
          "manager": {
            "username": "dmcquade",
            "displayName": "dmcquade"
          }
        }
      ]
    }
  ],
  "pagination": {
    "total": 114,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

### GET /api/leagues/:leagueId/history
Get complete dynasty history chain.

**Example:**
```bash
curl http://localhost:3001/api/leagues/1191596293294166016/history
```

**Response:**
```json
{
  "totalSeasons": 5,
  "leagues": [
    {
      "sleeperLeagueId": "716048884559835136",
      "name": "Dynasty Domination", 
      "season": "2021",
      "status": "complete",
      "inDatabase": false
    }
  ],
  "currentLeague": { /* current season details */ },
  "oldestLeague": { /* 2021 season details */ },
  "missingSeasons": [],
  "brokenChains": []
}
```

### GET /api/leagues/search/:username  
Find all leagues for a username.

**Example:**
```bash
curl http://localhost:3001/api/leagues/search/jrygrande
```

## Player Endpoints

### GET /api/players/search/:sleeperId
Find player by Sleeper ID.

**Example:**
```bash
curl http://localhost:3001/api/players/search/9229
```

**Response:**
```json
{
  "player": {
    "id": "cmf08zh6l06ujohk4su0fc5pj",
    "sleeperId": "9229",
    "fullName": "Anthony Richardson",
    "position": "QB", 
    "team": "IND",
    "age": 23,
    "dataCount": {
      "transactionItems": 2,
      "weeklyScores": 54
    }
  }
}
```

### GET /api/players/:playerId/transaction-chain
Get complete trade history for a player (⚠️ Currently has BigInt serialization issue).

**Parameters:**
- `leagueId` - Optional: Filter to specific league

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error description",
  "code": "ERROR_CODE",
  "timestamp": "2025-08-31T22:13:38.610Z"
}
```

## Rate Limiting

- Sleeper API: 1000 requests/minute
- Our API respects this limit with 100ms delays between calls
- Intelligent caching reduces API calls

## Data Freshness

- **Cached Data:** Most responses come from database for speed
- **Live Sync:** Use sync endpoints to refresh from Sleeper API  
- **Auto-refresh:** Future enhancement for automatic background sync