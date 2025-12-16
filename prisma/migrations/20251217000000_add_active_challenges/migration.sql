-- CreateTable
CREATE TABLE "active_challenges" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "beatmapId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "challengerUserId" TEXT NOT NULL,
    "challengerOsuId" TEXT NOT NULL,
    "challengerScore" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "active_challenges_guildId_beatmapId_difficulty_key" ON "active_challenges"("guildId", "beatmapId", "difficulty");

-- CreateIndex
CREATE INDEX "active_challenges_guildId_idx" ON "active_challenges"("guildId");

-- CreateIndex
CREATE INDEX "active_challenges_beatmapId_idx" ON "active_challenges"("beatmapId");

