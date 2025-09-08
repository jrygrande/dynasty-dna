/*
  Warnings:

  - You are about to drop the column `draftSlot` on the `draft_picks` table. All the data in the column will be lost.
  - You are about to drop the column `pickNumber` on the `draft_picks` table. All the data in the column will be lost.
  - You are about to drop the column `playerSelectedId` on the `draft_picks` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "dynasty_leagues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "foundedYear" TEXT NOT NULL,
    "currentLeagueId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_draft_picks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "originalRosterId" INTEGER,
    "currentRosterId" INTEGER,
    "previousRosterId" INTEGER,
    "originalOwnerId" TEXT,
    "originalOwnerName" TEXT,
    "currentOwnerId" TEXT,
    "currentOwnerName" TEXT,
    "previousOwnerId" TEXT,
    "previousOwnerName" TEXT,
    "selectedPlayerId" TEXT,
    "draftId" TEXT,
    "selectingOwnerId" TEXT,
    "selectingOwnerName" TEXT,
    "traded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "draft_picks_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_previousOwnerId_fkey" FOREIGN KEY ("previousOwnerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_selectedPlayerId_fkey" FOREIGN KEY ("selectedPlayerId") REFERENCES "players" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_selectingOwnerId_fkey" FOREIGN KEY ("selectingOwnerId") REFERENCES "managers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "draft_picks_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_draft_picks" ("createdAt", "currentOwnerId", "id", "leagueId", "originalOwnerId", "previousOwnerId", "round", "season", "traded", "updatedAt") SELECT "createdAt", "currentOwnerId", "id", "leagueId", "originalOwnerId", "previousOwnerId", "round", "season", "traded", "updatedAt" FROM "draft_picks";
DROP TABLE "draft_picks";
ALTER TABLE "new_draft_picks" RENAME TO "draft_picks";
CREATE INDEX "draft_picks_currentOwnerId_idx" ON "draft_picks"("currentOwnerId");
CREATE INDEX "draft_picks_selectedPlayerId_idx" ON "draft_picks"("selectedPlayerId");
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
    "dynastyLeagueId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leagues_dynastyLeagueId_fkey" FOREIGN KEY ("dynastyLeagueId") REFERENCES "dynasty_leagues" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_leagues" ("createdAt", "id", "name", "previousLeagueId", "rosterPositions", "scoringSettings", "season", "seasonType", "sleeperLeagueId", "sleeperPreviousLeagueId", "sport", "status", "totalRosters", "updatedAt") SELECT "createdAt", "id", "name", "previousLeagueId", "rosterPositions", "scoringSettings", "season", "seasonType", "sleeperLeagueId", "sleeperPreviousLeagueId", "sport", "status", "totalRosters", "updatedAt" FROM "leagues";
DROP TABLE "leagues";
ALTER TABLE "new_leagues" RENAME TO "leagues";
CREATE UNIQUE INDEX "leagues_sleeperLeagueId_key" ON "leagues"("sleeperLeagueId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
