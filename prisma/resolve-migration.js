/**
 * Script to resolve failed migration
 * Run this on Railway to mark the failed migration as rolled back
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resolveMigration() {
  try {
    // Check if the table already exists
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'active_challenges'
      );
    `;

    if (tableExists[0]?.exists) {
      console.log('⚠️  Table active_challenges already exists!');
      console.log('Dropping the table to start fresh...');
      
      // Drop the table if it exists
      await prisma.$executeRaw`DROP TABLE IF EXISTS "active_challenges" CASCADE;`;
      console.log('✅ Table dropped');
    }

    // Mark the failed migration as rolled back
    await prisma.$executeRaw`
      DELETE FROM "_prisma_migrations" 
      WHERE migration_name = '20251217005840_add_active_challenges' 
      AND finished_at IS NULL;
    `;

    console.log('✅ Failed migration marked as rolled back');
    console.log('You can now run: npx prisma migrate deploy');
    
  } catch (error) {
    console.error('Error resolving migration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

resolveMigration();

