-- CreateIndex
CREATE INDEX "draft_picks_playerSelectedId_idx" ON "draft_picks"("playerSelectedId");

-- CreateIndex
CREATE INDEX "draft_picks_leagueId_idx" ON "draft_picks"("leagueId");

-- CreateIndex
CREATE INDEX "transaction_items_playerId_idx" ON "transaction_items"("playerId");

-- CreateIndex
CREATE INDEX "transaction_items_transactionId_idx" ON "transaction_items"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_items_draftPickId_idx" ON "transaction_items"("draftPickId");

-- CreateIndex
CREATE INDEX "transactions_leagueId_idx" ON "transactions"("leagueId");

-- CreateIndex
CREATE INDEX "transactions_timestamp_idx" ON "transactions"("timestamp");

-- CreateIndex
CREATE INDEX "transactions_leagueId_timestamp_idx" ON "transactions"("leagueId", "timestamp");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");
