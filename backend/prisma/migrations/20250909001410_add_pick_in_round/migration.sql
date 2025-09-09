/*
  Fixed migration to add pickInRound column with default value.
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_draft_picks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "pickInRound" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_draft_picks" ("createdAt", "currentOwnerId", "currentOwnerName", "currentRosterId", "draftId", "id", "leagueId", "originalOwnerId", "originalOwnerName", "originalRosterId", "pickInRound", "previousOwnerId", "previousOwnerName", "previousRosterId", "round", "season", "selectedPlayerId", "selectingOwnerId", "selectingOwnerName", "traded", "updatedAt") SELECT "createdAt", "currentOwnerId", "currentOwnerName", "currentRosterId", "draftId", "id", "leagueId", "originalOwnerId", "originalOwnerName", "originalRosterId", 1, "previousOwnerId", "previousOwnerName", "previousRosterId", "round", "season", "selectedPlayerId", "selectingOwnerId", "selectingOwnerName", "traded", "updatedAt" FROM "draft_picks";
DROP TABLE "draft_picks";
ALTER TABLE "new_draft_picks" RENAME TO "draft_picks";
CREATE INDEX "draft_picks_currentOwnerId_idx" ON "draft_picks"("currentOwnerId");
CREATE INDEX "draft_picks_selectedPlayerId_idx" ON "draft_picks"("selectedPlayerId");
CREATE UNIQUE INDEX "draft_picks_leagueId_season_round_originalOwnerId_key" ON "draft_picks"("leagueId", "season", "round", "originalOwnerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
