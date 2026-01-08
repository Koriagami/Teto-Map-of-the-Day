-- CreateTable
CREATE TABLE "local_scores" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "osuUserId" TEXT NOT NULL,
    "score" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_scores_guildId_discordUserId_idx" ON "local_scores"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "local_scores_osuUserId_idx" ON "local_scores"("osuUserId");



