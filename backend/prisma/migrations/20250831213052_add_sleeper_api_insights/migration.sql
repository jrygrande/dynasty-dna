/*
  Warnings:

  - You are about to drop the column `year` on the `draft_picks` table. All the data in the column will be lost.
  - You are about to drop the column `year` on the `leagues` table. All the data in the column will be lost.
  - You are about to alter the column `timestamp` on the `transactions` table. The data in that column could be lost. The data in that column will be cast from `DateTime` to `BigInt`.
  - Added the required column `season` to the `draft_picks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `season` to the `leagues` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sleeperRosterId` to the `rosters` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sleeperTransactionId` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "players" ADD COLUMN "injuryStatus" TEXT;
ALTER TABLE "players" ADD COLUMN "number" TEXT;

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "sleeperDraftId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "seasonType" TEXT NOT NULL DEFAULT 'regular',
    "status" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'nfl',
    "rounds" INTEGER NOT NULL,
    "draftType" TEXT NOT NULL DEFAULT 'linear',
    "startTime" BIGINT,
    "lastPicked" BIGINT,
    "created" BIGINT,
    "draftOrder" TEXT,
    "settings" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "drafts_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "draft_selections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "pickNumber" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "draftSlot" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "pickedBy" TEXT NOT NULL,
    "isKeeper" BOOLEAN,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "draft_selections_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draft_selections_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transaction_draft_picks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "draftPickId" TEXT,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "previousOwnerId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transaction_draft_picks_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transaction_draft_picks_draftPickId_fkey" FOREIGN KEY ("draftPickId") REFERENCES "draft_picks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "nfl_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "season" TEXT NOT NULL,
    "seasonType" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "leg" INTEGER NOT NULL,
    "previousSeason" TEXT NOT NULL,
    "seasonStartDate" TEXT NOT NULL,
    "displayWeek" INTEGER NOT NULL,
    "leagueSeason" TEXT NOT NULL,
    "leagueCreateSeason" TEXT NOT NULL,
    "seasonHasScores" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_draft_picks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "originalOwnerId" TEXT NOT NULL,
    "currentOwnerId" TEXT NOT NULL,
    "previousOwnerId" TEXT,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "pickNumber" INTEGER,
    "playerSelectedId" TEXT,
    "traded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "draft_picks_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_previousOwnerId_fkey" FOREIGN KEY ("previousOwnerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_playerSelectedId_fkey" FOREIGN KEY ("playerSelectedId") REFERENCES "players" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_draft_picks" ("createdAt", "currentOwnerId", "id", "leagueId", "originalOwnerId", "pickNumber", "playerSelectedId", "round", "traded", "updatedAt") SELECT "createdAt", "currentOwnerId", "id", "leagueId", "originalOwnerId", "pickNumber", "playerSelectedId", "round", "traded", "updatedAt" FROM "draft_picks";
DROP TABLE "draft_picks";
ALTER TABLE "new_draft_picks" RENAME TO "draft_picks";
CREATE UNIQUE INDEX "draft_picks_leagueId_season_round_originalOwnerId_key" ON "draft_picks"("leagueId", "season", "round", "originalOwnerId");
CREATE TABLE "new_leagues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperLeagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "seasonType" TEXT NOT NULL DEFAULT 'regular',
    "status" TEXT,
    "sport" TEXT NOT NULL DEFAULT 'nfl',
    "totalRosters" INTEGER NOT NULL,
    "rosterPositions" TEXT NOT NULL,
    "scoringSettings" TEXT NOT NULL,
    "previousLeagueId" TEXT,
    "sleeperPreviousLeagueId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_leagues" ("createdAt", "id", "name", "previousLeagueId", "rosterPositions", "scoringSettings", "sleeperLeagueId", "totalRosters", "updatedAt") SELECT "createdAt", "id", "name", "previousLeagueId", "rosterPositions", "scoringSettings", "sleeperLeagueId", "totalRosters", "updatedAt" FROM "leagues";
DROP TABLE "leagues";
ALTER TABLE "new_leagues" RENAME TO "leagues";
CREATE UNIQUE INDEX "leagues_sleeperLeagueId_key" ON "leagues"("sleeperLeagueId");
CREATE TABLE "new_managers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatar" TEXT,
    "teamName" TEXT,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_managers" ("avatar", "createdAt", "displayName", "id", "sleeperUserId", "updatedAt", "username") SELECT "avatar", "createdAt", "displayName", "id", "sleeperUserId", "updatedAt", "username" FROM "managers";
DROP TABLE "managers";
ALTER TABLE "new_managers" RENAME TO "managers";
CREATE UNIQUE INDEX "managers_sleeperUserId_key" ON "managers"("sleeperUserId");
CREATE TABLE "new_rosters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "sleeperRosterId" INTEGER NOT NULL,
    "week" INTEGER,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "fpts" REAL NOT NULL DEFAULT 0,
    "fptsAgainst" REAL NOT NULL DEFAULT 0,
    "fptsDecimal" REAL DEFAULT 0,
    "fptsAgainstDecimal" REAL DEFAULT 0,
    "waiveBudgetUsed" INTEGER NOT NULL DEFAULT 0,
    "waiverPosition" INTEGER,
    "totalMoves" INTEGER NOT NULL DEFAULT 0,
    "division" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "rosters_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rosters_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "managers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_rosters" ("createdAt", "fpts", "fptsAgainst", "id", "leagueId", "losses", "managerId", "ties", "updatedAt", "week", "wins") SELECT "createdAt", "fpts", "fptsAgainst", "id", "leagueId", "losses", "managerId", "ties", "updatedAt", "week", "wins" FROM "rosters";
DROP TABLE "rosters";
ALTER TABLE "new_rosters" RENAME TO "rosters";
CREATE UNIQUE INDEX "rosters_leagueId_sleeperRosterId_week_key" ON "rosters"("leagueId", "sleeperRosterId", "week");
CREATE TABLE "new_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "sleeperTransactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "week" INTEGER,
    "leg" INTEGER,
    "timestamp" BIGINT NOT NULL,
    "creator" TEXT,
    "consenterIds" TEXT,
    "rosterIds" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transactions_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transactions" ("createdAt", "id", "leagueId", "metadata", "status", "timestamp", "type", "updatedAt", "week") SELECT "createdAt", "id", "leagueId", "metadata", "status", "timestamp", "type", "updatedAt", "week" FROM "transactions";
DROP TABLE "transactions";
ALTER TABLE "new_transactions" RENAME TO "transactions";
CREATE UNIQUE INDEX "transactions_sleeperTransactionId_key" ON "transactions"("sleeperTransactionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "drafts_sleeperDraftId_key" ON "drafts"("sleeperDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "draft_selections_draftId_pickNumber_key" ON "draft_selections"("draftId", "pickNumber");

-- CreateIndex
CREATE UNIQUE INDEX "nfl_states_season_key" ON "nfl_states"("season");
