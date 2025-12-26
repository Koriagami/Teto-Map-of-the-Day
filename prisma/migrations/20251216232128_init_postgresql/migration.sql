-- CreateTable
CREATE TABLE "server_configs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "operatingChannelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submissionDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_associations" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "discordUsername" TEXT NOT NULL,
    "osuUsername" TEXT,
    "osuUserId" TEXT,
    "profileLink" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_associations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "server_configs_guildId_key" ON "server_configs"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_guildId_userId_submissionDate_key" ON "submissions"("guildId", "userId", "submissionDate");

-- CreateIndex
CREATE INDEX "submissions_guildId_userId_idx" ON "submissions"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_associations_guildId_discordUserId_key" ON "user_associations"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "user_associations_guildId_discordUserId_idx" ON "user_associations"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "user_associations_osuUserId_idx" ON "user_associations"("osuUserId");

-- CreateIndex
CREATE INDEX "user_associations_osuUsername_idx" ON "user_associations"("osuUsername");




