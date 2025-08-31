-- CreateTable
CREATE TABLE "player_weekly_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "season" TEXT NOT NULL,
    "points" REAL NOT NULL,
    "isStarter" BOOLEAN NOT NULL,
    "position" TEXT,
    "matchupId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "player_weekly_scores_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "player_weekly_scores_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "matchup_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "season" TEXT NOT NULL,
    "matchupId" INTEGER NOT NULL,
    "totalPoints" REAL NOT NULL,
    "opponentId" INTEGER,
    "won" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "matchup_results_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "player_weekly_scores_leagueId_playerId_week_season_key" ON "player_weekly_scores"("leagueId", "playerId", "week", "season");

-- CreateIndex
CREATE UNIQUE INDEX "matchup_results_leagueId_rosterId_week_season_key" ON "matchup_results"("leagueId", "rosterId", "week", "season");
