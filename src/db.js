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
    return config?.operatingChannelId || null;
  },

  async set(guildId, operatingChannelId) {
    return prisma.serverConfig.upsert({
      where: { guildId },
      update: { operatingChannelId, updatedAt: new Date() },
      create: { guildId, operatingChannelId },
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
};

// Cleanup function for graceful shutdown
export async function disconnect() {
  await prisma.$disconnect();
}

// Export prisma client for advanced queries if needed
export { prisma };
