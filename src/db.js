/**
 * Database module using Prisma with PostgreSQL
 * Provides a clean interface for database operations
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Server Config operations
export const serverConfig = {
  async get(guildId) {
    const config = await prisma.serverConfig.findUnique({
      where: { guildId },
    });
    return config || null;
  },

  async getChannelId(guildId, channelType) {
    const config = await prisma.serverConfig.findUnique({
      where: { guildId },
    });
    if (!config) return null;
    
    if (channelType === 'tmotd') {
      return config.tmotdChannelId || null;
    } else if (channelType === 'challenges') {
      return config.challengesChannelId || null;
    }
    return null;
  },

  async setChannel(guildId, channelType, channelId) {
    const updateData = {};
    if (channelType === 'tmotd') {
      updateData.tmotdChannelId = channelId;
    } else if (channelType === 'challenges') {
      updateData.challengesChannelId = channelId;
    } else {
      throw new Error(`Invalid channel type: ${channelType}`);
    }

    return prisma.serverConfig.upsert({
      where: { guildId },
      update: { ...updateData, updatedAt: new Date() },
      create: { guildId, ...updateData },
    });
  },

  async delete(guildId) {
    return prisma.serverConfig.delete({
      where: { guildId },
    }).catch(() => null); // Ignore if not found
  },
};

// Submission operations
export const submissions = {
  async getLastSubmissionDate(guildId, userId) {
    const submission = await prisma.submission.findFirst({
      where: {
        guildId,
        userId,
      },
      orderBy: {
        submissionDate: 'desc',
      },
    });
    return submission?.submissionDate || null;
  },

  async create(guildId, userId, submissionDate) {
    return prisma.submission.create({
      data: {
        guildId,
        userId,
        submissionDate,
      },
    });
  },

  async hasSubmittedToday(guildId, userId, today) {
    const submission = await prisma.submission.findUnique({
      where: {
        guildId_userId_submissionDate: {
          guildId,
          userId,
          submissionDate: today,
        },
      },
    });
    return !!submission;
  },

  async deleteOldEntries(beforeDate) {
    return prisma.submission.deleteMany({
      where: {
        submissionDate: {
          lt: beforeDate,
        },
      },
    });
  },
};

// User Association operations
export const associations = {
  async get(guildId, userId) {
    return prisma.userAssociation.findUnique({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId: userId,
        },
      },
    });
  },

  async set(guildId, userId, userData) {
    const { discordUsername, osuUsername, osuUserId, profileLink } = userData;
    return prisma.userAssociation.upsert({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId: userId,
        },
      },
      update: {
        discordUsername,
        osuUsername,
        osuUserId,
        profileLink,
        updatedAt: new Date(),
      },
      create: {
        guildId,
        discordUserId: userId,
        discordUsername,
        osuUsername,
        osuUserId,
        profileLink,
      },
    });
  },

  async delete(guildId, userId) {
    return prisma.userAssociation.delete({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId: userId,
        },
      },
    }).catch(() => null); // Ignore if not found
  },

  async findByOsuUserId(osuUserId) {
    return prisma.userAssociation.findMany({
      where: { osuUserId },
    });
  },

  async findByOsuUsername(osuUsername) {
    return prisma.userAssociation.findMany({
      where: { osuUsername },
    });
  },

  async findByOsuUserIdInGuild(guildId, osuUserId) {
    return prisma.userAssociation.findFirst({
      where: { 
        guildId,
        osuUserId,
      },
    });
  },

  async findByOsuUsernameInGuild(guildId, osuUsername) {
    return prisma.userAssociation.findFirst({
      where: { 
        guildId,
        osuUsername,
      },
    });
  },
};

// Active Challenge operations
export const activeChallenges = {
  async getByDifficulty(guildId, beatmapId, difficulty) {
    return prisma.activeChallenge.findUnique({
      where: {
        guildId_beatmapId_difficulty: {
          guildId,
          beatmapId,
          difficulty,
        },
      },
    });
  },

  async create(guildId, beatmapId, difficulty, challengerUserId, challengerOsuId, challengerScore) {
    return prisma.activeChallenge.create({
      data: {
        guildId,
        beatmapId,
        difficulty,
        challengerUserId,
        challengerOsuId,
        challengerScore,
      },
    });
  },

  async delete(guildId, beatmapId, difficulty) {
    return prisma.activeChallenge.delete({
      where: {
        guildId_beatmapId_difficulty: {
          guildId,
          beatmapId,
          difficulty,
        },
      },
    }).catch(() => null); // Ignore if not found
  },

  async updateChampion(guildId, beatmapId, difficulty, newChallengerUserId, newChallengerOsuId, newChallengerScore) {
    return prisma.activeChallenge.update({
      where: {
        guildId_beatmapId_difficulty: {
          guildId,
          beatmapId,
          difficulty,
        },
      },
      data: {
        challengerUserId: newChallengerUserId,
        challengerOsuId: newChallengerOsuId,
        challengerScore: newChallengerScore,
      },
    });
  },

  async getAll(guildId) {
    return prisma.activeChallenge.findMany({
      where: { guildId },
    });
  },
};

// Cleanup function for graceful shutdown
export async function disconnect() {
  await prisma.$disconnect();
}

// Export prisma client for advanced queries if needed
export { prisma };
