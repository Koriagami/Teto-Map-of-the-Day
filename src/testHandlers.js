/**
 * Test command implementations for /teto test (admin).
 * Each handler receives (interaction, guildId, ctx) where ctx provides createEmbed, getOperatingChannel, generateWeeklyUpdate, BOT_EMBED_COLOR.
 */

import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { prisma, associations } from './db.js';
import { getUser, extractBeatmapId } from './osu-api.js';
import { getBeatmapAndLink } from './helpers.js';
import { formatTetoText } from './emoji.js';
import {
  formatBeatmapLink,
  getMapTitle,
  getMapArtist,
  formatStarRating,
  formatPlayerStats,
  formatPlayerStatsCompact,
  getBeatmapsetImageUrl,
  compareScores,
} from './scoreHelpers.js';
import {
  mockScore,
  mockScoreSingleMod,
  mockChallengerScore,
  createMockResponderScore,
  mockMods,
  defaultDifficulty,
  createMockScores,
  mockRecentPlay1,
  mockRecentPlay2,
} from './test-mock-data.js';
import { drawCardPrototype, drawChallengeCard } from './card.js';

export async function testTrsCommand(interaction, guildId, ctx) {
  const { createEmbed, BOT_EMBED_COLOR } = ctx;
  try {
    const localScoreRecords = await prisma.localScore.findMany({
      where: { guildId },
      take: 1,
      orderBy: { createdAt: 'desc' }
    });

    let testScore;
    if (localScoreRecords.length > 0) {
      testScore = localScoreRecords[0].score;
    } else {
      testScore = mockScore;
    }

    const beatmapLink = formatBeatmapLink(testScore);
    const playerStats = await formatPlayerStats(testScore);
    const mapTitle = await getMapTitle(testScore);
    const artist = await getMapArtist(testScore);
    const difficulty = testScore.beatmap?.version || defaultDifficulty;
    const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, difficulty, artist);
    const starRatingText = await formatStarRating(testScore);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    const statusMessage = `\n**[TEST MODE]** This map is **WIP**. ${await formatTetoText('Teto will remember this score.')}`;
    const message = `**[TEST MODE]** Your most recent score on ${difficultyLink}:\n\n${playerStats}${statusMessage}`;

    const imageUrl = await getBeatmapsetImageUrl(testScore);
    return interaction.editReply({
      embeds: await createEmbed(message, imageUrl)
    });
  } catch (error) {
    console.error('Error in testTrsCommand:', error);
    throw error;
  }
}

export async function testTcCommand(interaction, guildId, ctx) {
  const { createEmbed } = ctx;
  try {
    const localScoreRecords = await prisma.localScore.findMany({
      where: { guildId },
      take: 1,
      orderBy: { createdAt: 'desc' }
    });

    let baseScore;
    if (localScoreRecords.length > 0) {
      baseScore = localScoreRecords[0].score;
    } else {
      baseScore = mockScoreSingleMod;
    }

    const testScores = createMockScores(baseScore, 3);

    const beatmapLink = formatBeatmapLink(testScores[0]);
    const mapTitle = await getMapTitle(testScores[0]);
    const artist = await getMapArtist(testScores[0]);
    const difficulty = testScores[0].beatmap?.version || defaultDifficulty;
    const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, difficulty, artist);
    const starRatingText = await formatStarRating(testScores[0]);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    let message = `**[TEST MODE]** Your scores on ${difficultyLink}:\n\n`;

    let enhancedScore = testScores[0];
    if (baseScore.beatmap && !enhancedScore.beatmap.cs) {
      enhancedScore = {
        ...enhancedScore,
        beatmap: {
          ...enhancedScore.beatmap,
          ...baseScore.beatmap
        }
      };
    }
    const playerStats = await formatPlayerStats(enhancedScore);
    message += `**Score #1**\n${playerStats}`;

    for (let i = 1; i < testScores.length; i++) {
      const compactStats = await formatPlayerStatsCompact(testScores[i]);
      message += `**Score #${i + 1}**: ${compactStats}\n`;
    }

    const imageUrl = await getBeatmapsetImageUrl(testScores[0]);
    return interaction.editReply({
      embeds: await createEmbed(message, imageUrl)
    });
  } catch (error) {
    console.error('Error in testTcCommand:', error);
    throw error;
  }
}

export async function testRscIssueCommand(interaction, guildId, ctx) {
  const { createEmbed } = ctx;
  try {
    const challenges = await prisma.activeChallenge.findMany({
      where: { guildId },
      take: 1,
      orderBy: { createdAt: 'desc' }
    });

    let testScore;
    if (challenges.length > 0) {
      testScore = challenges[0].challengerScore;
    } else {
      testScore = mockScore;
    }

    const beatmapLink = formatBeatmapLink(testScore);
    const playerStats = await formatPlayerStats(testScore);
    const mapTitle = await getMapTitle(testScore);
    const artist = await getMapArtist(testScore);
    const difficulty = testScore.beatmap?.version || defaultDifficulty;
    const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, difficulty, artist);
    const starRatingText = await formatStarRating(testScore);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    const challengeMessage = `**[TEST MODE]** <@${interaction.user.id}> has issued a challenge for ${difficultyLink}!\n\nBeat the score below and use \`/rsc\` command to respond!\n\n${playerStats}`;
    const imageUrl = await getBeatmapsetImageUrl(testScore);

    return interaction.editReply({
      embeds: await createEmbed(challengeMessage, imageUrl)
    });
  } catch (error) {
    console.error('Error in testRscIssueCommand:', error);
    throw error;
  }
}

export async function testRscRespondCommand(interaction, guildId, ctx) {
  const { createEmbed, BOT_EMBED_COLOR } = ctx;
  try {
    const challenges = await prisma.activeChallenge.findMany({
      where: { guildId },
      take: 1,
      orderBy: { createdAt: 'desc' }
    });

    let challengerScore, responderScore, championOsuId;
    if (challenges.length > 0) {
      challengerScore = challenges[0].challengerScore;
      championOsuId = challenges[0].challengerOsuId;
      if (!challengerScore.user) {
        challengerScore.user = { username: 'ChallengerUser' };
      }
      responderScore = createMockResponderScore(challengerScore, interaction.user.username);
    } else {
      challengerScore = mockChallengerScore;
      responderScore = createMockResponderScore(mockChallengerScore, interaction.user.username);
      championOsuId = null;
    }

    const mapTitle = await getMapTitle(challengerScore);
    const artist = await getMapArtist(challengerScore);
    const difficulty = challengerScore.beatmap?.version || defaultDifficulty;
    const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, difficulty, artist);
    const starRatingText = await formatStarRating(challengerScore);
    const beatmapLink = formatBeatmapLink(challengerScore);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    const comparisonResult = compareScores(challengerScore, responderScore, interaction.user.username);
    const { responderWins, statWinners } = comparisonResult;
    const responderWon = responderWins >= 3;
    const isOwnChallenge = challenges.length > 0 && challenges[0].challengerUserId === interaction.user.id;
    const loserSide = responderWon ? 'left' : 'right';

    let leftUser = { avatarBuffer: null, username: challengerScore.user?.username || 'Champion' };
    let rightUser = { avatarBuffer: null, username: interaction.user.username };
    if (championOsuId) {
      try {
        const championUser = await getUser(championOsuId);
        if (championUser) {
          leftUser.username = (championUser.username && String(championUser.username).trim()) || leftUser.username;
          if (championUser.avatar_url) {
            const res = await fetch(championUser.avatar_url);
            if (res.ok) leftUser.avatarBuffer = Buffer.from(await res.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn('[test rscr] Failed to fetch champion osu user:', e.message);
      }
    }
    const userId = interaction.user.id;
    const association = await associations.get(guildId, userId);
    if (association?.osuUserId) {
      try {
        const responderUser = await getUser(association.osuUserId);
        if (responderUser) {
          rightUser.username = (responderUser.username && String(responderUser.username).trim()) || interaction.user.username;
          if (responderUser.avatar_url) {
            const res = await fetch(responderUser.avatar_url);
            if (res.ok) rightUser.avatarBuffer = Buffer.from(await res.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn('[test rscr] Failed to fetch responder osu user:', e.message);
      }
    }

    const cardBuffer = await drawChallengeCard(leftUser, rightUser, challengerScore, responderScore, statWinners, loserSide);
    const cardAttachment = new AttachmentBuilder(cardBuffer, { name: 'challenge-card.png' });

    const statsLine = `(${responderWins}/5 key stats)`;
    const displayName = interaction.user.username;
    let statusMessage;
    if (isOwnChallenge) {
      statusMessage = responderWon
        ? `\n\n🏆 **${displayName} has improved the score! The stakes are higher now!** ${statsLine}`
        : `\n\n😅 **${displayName} has failed to improve the score. Let's pretend Teto didn't see that...**`;
    } else {
      statusMessage = responderWon
        ? `\n\n🏆 **${displayName} has won the challenge and is now the new champion!** ${statsLine}`
        : `\n\n❌ **${displayName} did not win the challenge.** ${statsLine} The current champion remains.`;
    }
    const messageBeforeImage = `**[TEST MODE]**\n<@${interaction.user.id}> has responded to the challenge on ${difficultyLink}!\nLet's see who is better!`;
    const messageAfterImage = `${statusMessage}`;

    const embed1 = new EmbedBuilder()
      .setColor(BOT_EMBED_COLOR)
      .setDescription(messageBeforeImage)
      .setImage('attachment://challenge-card.png');
    const embed2 = new EmbedBuilder()
      .setColor(BOT_EMBED_COLOR)
      .setDescription(messageAfterImage);
    return interaction.editReply({
      embeds: [embed1, embed2],
      files: [cardAttachment],
    });
  } catch (error) {
    console.error('Error in testRscRespondCommand:', error);
    throw error;
  }
}

export async function testMotdCommand(interaction, guildId, ctx) {
  const { createEmbed } = ctx;
  try {
    const mapLink = 'https://osu.ppy.sh/beatmapsets/1322944#osu/2988681';

    let mapName = null;
    let difficultyName = null;
    let difficultyLink = mapLink;
    let imageUrl = null;
    let beatmap = null;

    try {
      const beatmapId = extractBeatmapId(mapLink);
      if (beatmapId) {
        const { beatmap: b, link } = await getBeatmapAndLink(beatmapId);
        beatmap = b;
        if (beatmap) {
          mapName = beatmap?.beatmapset?.title || beatmap?.beatmapset?.title_unicode || null;
          difficultyName = beatmap?.version || null;
          imageUrl = await getBeatmapsetImageUrl(beatmap);
          if (link) difficultyLink = link;
        }
      }
    } catch (error) {
      console.error('Error getting beatmap data for test motd:', error);
    }

    const artist = beatmap?.beatmapset?.artist || beatmap?.beatmapset?.artist_unicode || '';
    let difficultyLabel = null;
    if (mapName && difficultyName) {
      const labelWithStar = ctx.formatDifficultyLabel(mapName, difficultyName, artist);
      difficultyLabel = `[${labelWithStar}](${difficultyLink})`;
    } else if (difficultyName) {
      const labelWithStar = ctx.formatDifficultyLabel('Unknown Map', difficultyName, artist);
      difficultyLabel = `[${labelWithStar}](${difficultyLink})`;
    } else {
      difficultyLabel = difficultyLink;
    }

    const mods = mockMods;
    let msgContent = `**[TEST MODE]** <@${interaction.user.id}> map of the day is - ${difficultyLabel}`;
    if (mods.length > 0) {
      msgContent += `\nRecommended mods: ${mods.join(', ')}`;
    }

    return interaction.editReply({
      embeds: await createEmbed(msgContent, imageUrl)
    });
  } catch (error) {
    console.error('Error in testMotdCommand:', error);
    throw error;
  }
}

export async function testReportCommand(interaction, guildId, ctx) {
  const { createEmbed, getOperatingChannel, generateWeeklyUpdate } = ctx;
  try {
    const opChannelResult = await getOperatingChannel(guildId, interaction.guild, 'challenges');
    if (opChannelResult.error || !opChannelResult.channel) {
      return interaction.editReply({
        embeds: await createEmbed(opChannelResult.error || 'Challenges channel is not configured. Use `/teto setup` to configure it.'),
        ephemeral: true
      });
    }

    const messages = await generateWeeklyUpdate(guildId);

    if (messages && messages.length > 0) {
      const allEmbeds = messages.flat();
      const embedChunks = [];
      for (let i = 0; i < allEmbeds.length; i += 10) {
        embedChunks.push(allEmbeds.slice(i, i + 10));
      }

      if (embedChunks.length > 0) {
        await interaction.editReply({
          embeds: embedChunks[0],
          content: '**[TEST MODE]** Weekly challenges report preview:'
        });

        for (let i = 1; i < embedChunks.length; i++) {
          await interaction.followUp({
            embeds: embedChunks[i],
            ephemeral: false
          });
        }
      }
    } else {
      return interaction.editReply({
        embeds: await createEmbed('**[TEST MODE]** No challenges data to report for the last 30 days.'),
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error in testReportCommand:', error);
    throw error;
  }
}

export async function testCardCommand(interaction, guildId, ctx) {
  const { createEmbed } = ctx;
  try {
    const userId = interaction.user.id;
    const association = await associations.get(guildId, userId);
    if (!association?.osuUserId) {
      return interaction.editReply({
        embeds: await createEmbed('Link your osu! profile first with `/teto link` to show your profile picture on the card.'),
        ephemeral: true,
      });
    }

    let avatarBuffer = null;
    const osuUser = await getUser(association.osuUserId);
    if (osuUser?.avatar_url) {
      try {
        const res = await fetch(osuUser.avatar_url);
        if (res.ok) avatarBuffer = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        console.warn('[card] Failed to fetch osu! avatar:', e.message);
      }
    }

    const osuUsername = (osuUser?.username && String(osuUser.username).trim()) || (association?.osuUsername && String(association.osuUsername).trim()) || 'Player';
    const recentScores = [mockRecentPlay1, mockRecentPlay2];
    const pngBuffer = await drawCardPrototype(avatarBuffer, osuUsername, recentScores);
    const attachment = new AttachmentBuilder(pngBuffer, { name: 'card.png' });
    return interaction.editReply({
      content: '**[TEST MODE]** Card prototype (avatar + username + 2 most recent plays stats):',
      files: [attachment],
    });
  } catch (error) {
    console.error('Error in testCardCommand:', error);
    throw error;
  }
}

/** Run a test subcommand by name. Returns true if handled. */
export async function runTestCommand(interaction, guildId, testCommand, ctx) {
  const handlers = {
    trs: testTrsCommand,
    tc: testTcCommand,
    rsci: testRscIssueCommand,
    rscr: testRscRespondCommand,
    motd: testMotdCommand,
    report: testReportCommand,
    card: testCardCommand,
  };
  const handler = handlers[testCommand];
  if (handler) {
    await handler(interaction, guildId, ctx);
    return true;
  }
  return false;
}
