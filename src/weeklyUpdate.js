/**
 * Weekly update: format challenge entries and generate weekly report embeds.
 * generateWeeklyUpdate(guildId, createEmbed) returns array of embed arrays (chunks of up to 10).
 */

import { formatDifficultyLabel } from './helpers.js';
import { formatTetoText } from './emoji.js';
import { getMapTitle, getMapArtist, formatStarRating, formatBeatmapLink } from './scoreHelpers.js';
import { activeChallenges } from './db.js';

/** Substring that appears in the weekly update header embed (see generateWeeklyUpdate). */
export const WEEKLY_UPDATE_MARKER = 'TETO WEEKLY UPDATE!';

/**
 * True if the single latest channel message embed text contains the weekly update header marker.
 * @param {import('discord.js').Message | null | undefined} latestMessage
 * @returns {boolean}
 */
export function latestMessageIsWeeklyUpdate(latestMessage) {
  if (!latestMessage?.embeds?.length) return false;
  for (const embed of latestMessage.embeds) {
    const description = embed.description;
    if (description?.includes(WEEKLY_UPDATE_MARKER)) return true;
  }
  return false;
}

/** Format a single challenge entry for the weekly update (no time held). */
export async function formatChallengeEntry(challenge) {
  try {
    const score = challenge.challengerScore;
    if (!score || typeof score !== 'object') {
      return `**Unknown Map [${challenge.difficulty}]** - <@${challenge.challengerUserId}>`;
    }

    const mapTitle = await getMapTitle(score);
    const artist = await getMapArtist(score);
    const difficultyLabel = formatDifficultyLabel(mapTitle, challenge.difficulty, artist);
    const starRatingText = await formatStarRating(score);
    const beatmapLink = formatBeatmapLink(score);

    if (beatmapLink) {
      return `${starRatingText}[${difficultyLabel}](${beatmapLink}) - <@${challenge.challengerUserId}>`;
    }
    return `${starRatingText}**${difficultyLabel}** - <@${challenge.challengerUserId}>`;
  } catch (error) {
    console.error('Error formatting challenge entry:', error);
    return `**Unknown Map [${challenge.difficulty}]** - <@${challenge.challengerUserId}>`;
  }
}

/** Calculate time held in days and hours from updatedAt to now. */
export function calculateTimeHeld(updatedAt) {
  const now = new Date();
  const startTime = new Date(updatedAt);
  const diffMs = now - startTime;
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return { days, hours, totalHours };
}

/** Format challenge entry with time held (for defense streaks). */
export async function formatChallengeEntryWithDays(challenge, timeHeld) {
  try {
    const score = challenge.challengerScore;
    if (!score || typeof score !== 'object') {
      const timeStr = timeHeld.days > 0
        ? `${timeHeld.days} ${timeHeld.days === 1 ? 'day' : 'days'} ${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`
        : `${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`;
      return `**Unknown Map [${challenge.difficulty}]** - <@${challenge.challengerUserId}> [Held for ${timeStr}]`;
    }

    const mapTitle = await getMapTitle(score);
    const artist = await getMapArtist(score);
    const difficultyLabel = formatDifficultyLabel(mapTitle, challenge.difficulty, artist);
    const starRatingText = await formatStarRating(score);
    const beatmapLink = formatBeatmapLink(score);

    const timeStr = timeHeld.days > 0
      ? `${timeHeld.days} ${timeHeld.days === 1 ? 'day' : 'days'} ${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`
      : `${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`;

    if (beatmapLink) {
      return `${starRatingText}[${difficultyLabel}](${beatmapLink}) - <@${challenge.challengerUserId}> [Held for ${timeStr}]`;
    }
    return `${starRatingText}**${difficultyLabel}** - <@${challenge.challengerUserId}> [Held for ${timeStr}]`;
  } catch (error) {
    console.error('Error formatting challenge entry with days:', error);
    try {
      const timeStr = timeHeld.days > 0
        ? `${timeHeld.days} ${timeHeld.days === 1 ? 'day' : 'days'} ${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`
        : `${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`;
      return `**Unknown Map [${challenge.difficulty}]** - <@${challenge.challengerUserId}> [Held for ${timeStr}]`;
    } catch {
      return `**Unknown Map [${challenge.difficulty}]** - <@${challenge.challengerUserId}>`;
    }
  }
}

/**
 * Generate weekly update message chunks for a guild.
 * @param {string} guildId
 * @param { (content: string, imageUrl?: string) => Promise<import('discord.js').EmbedBuilder[]> } createEmbed
 * @returns {Promise<import('discord.js').EmbedBuilder[][]|null>} Array of embed arrays (each chunk up to 10), or null
 */
export async function generateWeeklyUpdate(guildId, createEmbed) {
  try {
    const challenges = await activeChallenges.getChallengesInLast30Days(guildId);
    if (challenges.length === 0) {
      return null;
    }

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const newChampions = [];
    const uncontestedChallenges = [];

    for (const challenge of challenges) {
      if (challenge.guildId !== guildId) {
        console.warn(`Challenge ${challenge.id} has mismatched guildId. Expected ${guildId}, got ${challenge.guildId}`);
        continue;
      }

      const createdAt = new Date(challenge.createdAt);
      const updatedAt = new Date(challenge.updatedAt);

      if (updatedAt >= fourteenDaysAgo && updatedAt.getTime() !== createdAt.getTime()) {
        newChampions.push(challenge);
      } else if (createdAt >= fourteenDaysAgo &&
        challenge.originalChallengerUserId &&
        challenge.challengerUserId === challenge.originalChallengerUserId &&
        updatedAt.getTime() === createdAt.getTime()) {
        uncontestedChallenges.push(challenge);
      }
    }

    const allChallenges = await activeChallenges.getAllChallengesForDefenseStreaks(guildId);

    const challengesWithTimeHeld = allChallenges
      .filter(challenge => {
        if (challenge.guildId !== guildId) {
          console.warn(`Challenge ${challenge.id} has mismatched guildId. Expected ${guildId}, got ${challenge.guildId}`);
          return false;
        }
        return true;
      })
      .map(challenge => {
        const timeHeld = calculateTimeHeld(challenge.updatedAt);
        return { challenge, timeHeld };
      });

    challengesWithTimeHeld.sort((a, b) => b.timeHeld.totalHours - a.timeHeld.totalHours);
    const topDefenseStreaks = challengesWithTimeHeld.slice(0, 5);

    const challengeCountByUser = new Map();
    for (const { challenge } of challengesWithTimeHeld) {
      const userId = challenge.challengerUserId;
      challengeCountByUser.set(userId, (challengeCountByUser.get(userId) || 0) + 1);
    }
    const topChallengeHolders = [...challengeCountByUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const newChampionsEntries = await Promise.all(newChampions.map(formatChallengeEntry));
    const uncontestedEntries = await Promise.all(uncontestedChallenges.map(formatChallengeEntry));
    const defenseStreakEntries = await Promise.all(
      topDefenseStreaks.map(({ challenge, timeHeld }) => formatChallengeEntryWithDays(challenge, timeHeld))
    );

    const emptyState = await formatTetoText('The players have been slacking off lately. Teto has nothing to show here');

    const sections = [];

    sections.push('🏆 **New champions:**');
    if (newChampionsEntries.length > 0) {
      sections.push(...newChampionsEntries.map(entry => `• ${entry}`));
    } else {
      sections.push(emptyState);
    }
    sections.push('');

    sections.push('🫵 **New uncontested challenges:**');
    if (uncontestedEntries.length > 0) {
      sections.push(...uncontestedEntries.map(entry => `• ${entry}`));
    } else {
      sections.push(emptyState);
    }
    sections.push('');

    sections.push('🛡️ **Longest defence streak:**');
    if (defenseStreakEntries.length > 0) {
      sections.push(...defenseStreakEntries.map(entry => `• ${entry}`));
    } else {
      sections.push(emptyState);
    }
    sections.push('');

    sections.push('👑 **Most challenges held:**');
    if (topChallengeHolders.length > 0) {
      const medalEmojis = ['🥇', '🥈', '🥉'];
      for (let i = 0; i < topChallengeHolders.length; i++) {
        const [userId, count] = topChallengeHolders[i];
        sections.push(`${medalEmojis[i]} <@${userId}> - ${count} ${count === 1 ? 'challenge' : 'challenges'}`);
      }
    } else {
      sections.push(emptyState);
    }

    if (sections.length === 0) {
      return null;
    }

    const header = await formatTetoText('**TETO WEEKLY UPDATE!**\n\n');
    const content = sections.join('\n');
    const fullContent = header + content;

    const embeds = await createEmbed(fullContent);

    const messages = [];
    for (let i = 0; i < embeds.length; i += 10) {
      messages.push(embeds.slice(i, i + 10));
    }

    return messages;
  } catch (error) {
    console.error('Error generating weekly update:', error);
    return null;
  }
}
