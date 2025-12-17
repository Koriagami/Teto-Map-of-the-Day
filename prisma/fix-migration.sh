#!/bin/bash
# Script to fix failed migration
# This marks the failed migration as rolled back so it can be retried

echo "Checking for failed migrations..."

# Mark the failed migration as rolled back
npx prisma migrate resolve --rolled-back 20251217005840_add_active_challenges || {
  echo "Migration not found in failed state, trying to clean up manually..."
  
  # Alternative: Use SQL to clean up
  psql $DATABASE_URL -c "DELETE FROM _prisma_migrations WHERE migration_name = '20251217005840_add_active_challenges' AND finished_at IS NULL;" || true
  psql $DATABASE_URL -c "DROP TABLE IF EXISTS active_challenges CASCADE;" || true
}

echo "Failed migration resolved. Retrying migration..."
npx prisma migrate deploy

