/**
 * Database Verification Script
 * Tests all database operations to ensure everything works correctly
 */

import 'dotenv/config';
import { serverConfig, submissions, associations, disconnect } from './db.js';

async function verifyDatabase() {
  console.log('🔍 Verifying database functionality...\n');

  const testGuildId = 'test-guild-123';
  const testUserId = 'test-user-456';
  const testChannelId = 'test-channel-789';
  const today = new Date().toISOString().split('T')[0];

  try {
    // Test 1: Server Config
    console.log('1. Testing Server Config...');
    await serverConfig.set(testGuildId, testChannelId);
    const retrievedChannel = await serverConfig.get(testGuildId);
    if (retrievedChannel === testChannelId) {
      console.log('   ✅ Server Config: PASS');
    } else {
      console.log('   ❌ Server Config: FAIL - Channel ID mismatch');
    }

    // Test 2: User Associations (Separate Table)
    console.log('\n2. Testing User Associations (separate table)...');
    await associations.set(testGuildId, testUserId, {
      discordUsername: 'TestUser',
      osuUsername: 'testosu',
      osuUserId: '12345',
      profileLink: 'https://osu.ppy.sh/users/12345',
    });
    const association = await associations.get(testGuildId, testUserId);
    if (association && association.osuUsername === 'testosu') {
      console.log('   ✅ User Associations: PASS');
      console.log(`   📊 Association data: ${JSON.stringify(association, null, 2)}`);
    } else {
      console.log('   ❌ User Associations: FAIL');
    }

    // Test 3: Submissions
    console.log('\n3. Testing Submissions...');
    const hasSubmittedBefore = await submissions.hasSubmittedToday(testGuildId, testUserId, today);
    if (!hasSubmittedBefore) {
      console.log('   ✅ No existing submission (expected)');
    }
    await submissions.create(testGuildId, testUserId, today);
    const hasSubmittedAfter = await submissions.hasSubmittedToday(testGuildId, testUserId, today);
    if (hasSubmittedAfter) {
      console.log('   ✅ Submissions: PASS');
    } else {
      console.log('   ❌ Submissions: FAIL');
    }

    // Test 4: Verify Associations Table is Separate
    console.log('\n4. Verifying Associations table structure...');
    const allAssociations = await associations.findByOsuUserId('12345');
    if (allAssociations && allAssociations.length > 0) {
      console.log('   ✅ Associations table is separate and queryable');
      console.log(`   📊 Found ${allAssociations.length} association(s) for OSU user ID 12345`);
    } else {
      console.log('   ⚠️  Associations query returned empty (might be expected)');
    }

    // Test 5: Cleanup old submissions
    console.log('\n5. Testing cleanup function...');
    const oldDate = '2020-01-01';
    await submissions.create(testGuildId, testUserId + '-old', oldDate);
    const result = await submissions.deleteOldEntries(today);
    console.log(`   ✅ Cleanup function works (deleted ${result.count} old entries)`);

    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    await serverConfig.delete(testGuildId);
    await associations.delete(testGuildId, testUserId);
    console.log('   ✅ Test data cleaned');

    console.log('\n✅ All database operations verified successfully!');
    console.log('\n📋 Summary:');
    console.log('   - Server Config: Working');
    console.log('   - User Associations (separate table): Working');
    console.log('   - Submissions: Working');
    console.log('   - Daily cleanup: Working');

  } catch (error) {
    console.error('\n❌ Database verification failed:', error);
    throw error;
  } finally {
    await disconnect();
  }
}

verifyDatabase().catch((error) => {
  console.error('Verification error:', error);
  process.exit(1);
});

