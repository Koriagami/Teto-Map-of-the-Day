-- AlterTable
-- Add new columns for separate channel types
ALTER TABLE "server_configs" ADD COLUMN "tmotdChannelId" TEXT;
ALTER TABLE "server_configs" ADD COLUMN "challengesChannelId" TEXT;

-- Migrate existing data: copy operatingChannelId to both new columns if it exists
UPDATE "server_configs" 
SET "tmotdChannelId" = "operatingChannelId",
    "challengesChannelId" = "operatingChannelId"
WHERE "operatingChannelId" IS NOT NULL;

-- Drop the old column
ALTER TABLE "server_configs" DROP COLUMN "operatingChannelId";

