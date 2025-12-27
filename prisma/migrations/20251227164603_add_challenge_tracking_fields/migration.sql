-- AlterTable
-- Add new fields for tracking challenge ownership
ALTER TABLE "active_challenges" ADD COLUMN "originalChallengerUserId" TEXT;
ALTER TABLE "active_challenges" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Migrate existing data: set originalChallengerUserId to current challengerUserId
UPDATE "active_challenges" 
SET "originalChallengerUserId" = "challengerUserId"
WHERE "originalChallengerUserId" IS NULL;

-- Make originalChallengerUserId required (after migration)
ALTER TABLE "active_challenges" ALTER COLUMN "originalChallengerUserId" SET NOT NULL;

