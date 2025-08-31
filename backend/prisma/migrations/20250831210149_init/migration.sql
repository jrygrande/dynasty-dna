-- CreateTable
CREATE TABLE "leagues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperLeagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "totalRosters" INTEGER NOT NULL,
    "rosterPositions" TEXT NOT NULL,
    "scoringSettings" TEXT NOT NULL,
    "previousLeagueId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "position" TEXT,
    "team" TEXT,
    "age" INTEGER,
    "yearsExp" INTEGER,
    "status" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "managers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatar" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "week" INTEGER,
    "timestamp" DATETIME NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transactions_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transaction_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "managerId" TEXT,
    "playerId" TEXT,
    "draftPickId" TEXT,
    "faabAmount" INTEGER,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transaction_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transaction_items_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transaction_items_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transaction_items_draftPickId_fkey" FOREIGN KEY ("draftPickId") REFERENCES "draft_picks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rosters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "week" INTEGER,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "fpts" REAL NOT NULL DEFAULT 0,
    "fptsAgainst" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "rosters_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rosters_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "roster_slots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roster_slots_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "rosters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "roster_slots_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "draft_picks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "originalOwnerId" TEXT NOT NULL,
    "currentOwnerId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "pickNumber" INTEGER,
    "playerSelectedId" TEXT,
    "traded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "draft_picks_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_playerSelectedId_fkey" FOREIGN KEY ("playerSelectedId") REFERENCES "players" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "leagues_sleeperLeagueId_key" ON "leagues"("sleeperLeagueId");

-- CreateIndex
CREATE UNIQUE INDEX "players_sleeperId_key" ON "players"("sleeperId");

-- CreateIndex
CREATE UNIQUE INDEX "managers_sleeperUserId_key" ON "managers"("sleeperUserId");

-- CreateIndex
CREATE UNIQUE INDEX "rosters_leagueId_managerId_week_key" ON "rosters"("leagueId", "managerId", "week");

-- CreateIndex
CREATE UNIQUE INDEX "draft_picks_leagueId_year_round_originalOwnerId_key" ON "draft_picks"("leagueId", "year", "round", "originalOwnerId");
