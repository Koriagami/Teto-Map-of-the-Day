/**
 * Pre-migration check script
 * Resolves failed migrations before attempting new ones
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function checkAndResolve() {
  try {
    // Check for failed migrations
    const failedMigrations = await prisma.$queryRaw`
      SELECT migration_name, started_at, finished_at
      FROM _prisma_migrations
      WHERE finished_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1;
    `;

    if (failedMigrations && failedMigrations.length > 0) {
      const failed = failedMigrations[0];
      console.log(`⚠️  Found failed migration: ${failed.migration_name}`);
      
      if (failed.migration_name === '20251217005840_add_active_challenges') {
        console.log('Cleaning up failed migration...');
        
        // Check if table exists (partial migration)
        const tableExists = await prisma.$queryRaw`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'active_challenges'
          );
        `;

        if (tableExists[0]?.exists) {
          console.log('Removing partially created table...');
          await prisma.$executeRaw`DROP TABLE IF EXISTS "active_challenges" CASCADE;`;
        }

        // Mark migration as rolled back
        await prisma.$executeRaw`
          DELETE FROM _prisma_migrations 
          WHERE migration_name = '20251217005840_add_active_challenges' 
          AND finished_at IS NULL;
        `;
        
        console.log('✅ Failed migration resolved');
      }
    } else {
      console.log('✅ No failed migrations found');
    }
  } catch (error) {
    // If _prisma_migrations table doesn't exist yet, that's fine
    if (error.message.includes('does not exist') || error.message.includes('relation')) {
      console.log('Migration table does not exist yet (first run)');
    } else {
      console.error('Error checking migrations:', error.message);
      // Don't throw - allow migration to proceed
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkAndResolve().catch(() => {
  // Silently fail - allow migration to proceed
  process.exit(0);
});


