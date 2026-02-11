import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  AttachmentBuilder,
} from 'discord.js';
import cron from 'node-cron';
import { commands } from './commands.js';
import { extractBeatmapId, getUserRecentScores, getUserBeatmapScore, getUserBeatmapScoresAll, getUser, getBeatmap, resolveMapOrScoreLink } from './osu-api.js';
import { buildBeatmapLinkFromIds, formatDifficultyLabel, getBeatmapAndLink } from './helpers.js';
import { initializeEmojis, formatTetoText } from './emoji.js';
import { extractScoreValue, compareScores, formatBeatmapLink, getBeatmapsetImageUrl, isValidScore, getMapTitle, getMapArtist, formatStarRating, formatPlayerStats, formatPlayerStatsCompact, getBeatmapStatusName, isScoreSavedOnOsu, extractBeatmapInfoFromMessage, extractOsuProfile } from './scoreHelpers.js';
import { serverConfig as dbServerConfig, submissions, associations, activeChallenges, localScores, disconnect, prisma } from './db.js';
import { drawChallengeCard } from './card.js';
import { handleRsc, handleTc, handleTrs, handleTeto } from './commandHandlers.js';
import { runTestCommand } from './testHandlers.js';
import { generateWeeklyUpdate as generateWeeklyUpdateFn } from './weeklyUpdate.js';
import { handleMessageReactionAdd } from './reactionHandler.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('DISCORD_TOKEN not set in environment.');
  process.exit(1);
}

// Parent guild ID for emojis (optional - if not set, will search all guilds)
const PARENT_GUILD_ID = process.env.PARENT_GUILD_ID;

// Bot embed color: #c6da29 (13030697 in decimal)
const BOT_EMBED_COLOR = 0xc6da29;

// Discord embed description character limit
const EMBED_DESCRIPTION_LIMIT = 4096;

// Helper: create embed(s) with bot color from content
// Returns an array of embeds (single embed if content fits, multiple if it needs splitting)
// imageUrl: optional beatmapset image URL to add to the first embed
async function createEmbed(content, imageUrl = null) {
  if (!content || typeof content !== 'string') {
    const embed = new EmbedBuilder().setColor(BOT_EMBED_COLOR).setDescription('');
    if (imageUrl) embed.setImage(imageUrl);
    return [embed];
  }

  // If content fits in one embed, return single embed
  if (content.length <= EMBED_DESCRIPTION_LIMIT) {
    const embed = new EmbedBuilder()
      .setColor(BOT_EMBED_COLOR)
      .setDescription(content);
    if (imageUrl) embed.setImage(imageUrl);
    return [embed];
  }

  // Content is too long, split into multiple embeds
  const embeds = [];
  const lines = content.split('\n');
  let currentChunk = '';
  
  for (const line of lines) {
    // Check if adding this line would exceed the limit
    const testChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    
    if (testChunk.length > EMBED_DESCRIPTION_LIMIT) {
      // Current chunk is full, save it and start a new one
      if (currentChunk) {
        const embed = new EmbedBuilder()
          .setColor(BOT_EMBED_COLOR)
          .setDescription(currentChunk);
        // Only add image to the first embed
        if (embeds.length === 0 && imageUrl) embed.setImage(imageUrl);
        embeds.push(embed);
      }
      
      // If a single line is too long, split it by character
      if (line.length > EMBED_DESCRIPTION_LIMIT) {
        // Split the long line into chunks
        for (let i = 0; i < line.length; i += EMBED_DESCRIPTION_LIMIT) {
          const chunk = line.substring(i, i + EMBED_DESCRIPTION_LIMIT);
          const embed = new EmbedBuilder()
            .setColor(BOT_EMBED_COLOR)
            .setDescription(chunk);
          // Only add image to the first embed
          if (embeds.length === 0 && imageUrl) embed.setImage(imageUrl);
          embeds.push(embed);
        }
        currentChunk = '';
      } else {
        currentChunk = line;
      }
    } else {
      // Add line to current chunk
      currentChunk = testChunk;
    }
  }
  
  // Add remaining chunk if any
  if (currentChunk) {
    const embed = new EmbedBuilder()
      .setColor(BOT_EMBED_COLOR)
      .setDescription(currentChunk);
    // Only add image to the first embed
    if (embeds.length === 0 && imageUrl) embed.setImage(imageUrl);
    embeds.push(embed);
  }
  
  // Discord allows max 10 embeds per message
  if (embeds.length > 10) {
    console.warn(`Content was split into ${embeds.length} embeds, but Discord only allows 10. Truncating to 10.`);
    return embeds.slice(0, 10);
  }
  
  return embeds;
}

// Helper: today's date string YYYY-MM-DD
function todayString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Helper: get operating channel with validation
// channelType: 'tmotd' for Teto Map of the Day, 'challenges' for Challenges
async function getOperatingChannel(guildId, guild, channelType) {
  const opChannelId = await dbServerConfig.getChannelId(guildId, channelType);
  if (!opChannelId) {
    const channelTypeName = channelType === 'tmotd' ? 'TMOTD' : 'Challenges';
    return { error: `${channelTypeName} channel is not set up yet. Ask an admin to use /teto setup.` };
  }

  try {
    const opChannel = await guild.channels.fetch(opChannelId);
    if (!opChannel) {
      return { error: 'Operating channel is invalid. Re-run setup.' };
    }
    return { channel: opChannel, channelId: opChannelId };
  } catch (err) {
    console.error('Failed to fetch operating channel', err);
    return { error: 'Operating channel is invalid. Re-run setup.' };
  }
}

// Helper: create and post a challenge announcement (caller should enrich score beatmap when from API)
async function createAndPostChallenge(guildId, userId, osuUserId, userScore, opChannel, interaction) {
  const beatmapId = userScore.beatmap?.id?.toString();
  const difficulty = userScore.beatmap?.version ?? 'Unknown';
  if (!beatmapId) throw new Error('createAndPostChallenge: score missing beatmap id');
  
  // Create new challenge
  await activeChallenges.create(
    guildId,
    beatmapId,
    difficulty,
    userId,
    osuUserId,
    userScore
  );

  // Post challenge announcement to operational channel
  const beatmapLink = formatBeatmapLink(userScore);
  const playerStats = await formatPlayerStats(userScore);
  const mapTitle = await getMapTitle(userScore);
  const artist = await getMapArtist(userScore);
  const difficultyLabel = formatDifficultyLabel(mapTitle, difficulty, artist);
  const starRatingText = await formatStarRating(userScore);
  const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;
  
  const challengeMessage = `<@${userId}> has issued a challenge for ${difficultyLink}!\n\nBeat the score below and use \`/rsc\` command to respond!\n\n${playerStats}`;
  
  // Get beatmapset image URL for the embed
  const imageUrl = await getBeatmapsetImageUrl(userScore);
  
  await opChannel.send({ embeds: await createEmbed(challengeMessage, imageUrl) });

  return { difficultyLink, imageUrl, difficultyLabel };
}

/** generateWeeklyUpdate bound with createEmbed for test/cron use. */
function generateWeeklyUpdate(guildId) {
  return generateWeeklyUpdateFn(guildId, createEmbed);
}

/** Build context for /teto test handlers. */
function buildTestContext() {
  return {
    createEmbed,
    getOperatingChannel,
    generateWeeklyUpdate,
    BOT_EMBED_COLOR,
    formatDifficultyLabel,
  };
}

// Database connection health check with retry
let dbReady = false;
async function waitForDatabase(maxRetries = 10, delayMs = 5000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connection established');
      dbReady = true;
      return true;
    } catch (error) {
      console.log(`⏳ Database not ready (attempt ${i}/${maxRetries}): ${error.message.split('\n')[0]}`);
      if (i < maxRetries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error('⚠️  Database unavailable after all retries. Bot will run but DB commands will fail.');
  return false;
}

// Handle unhandled promise rejections (prevents silent crashes)
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

// When ready
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag} — ${client.guilds.cache.size} guild(s)`);
  
  try {
    const { rankEmojiCache, tetoEmoji } = await initializeEmojis(client, PARENT_GUILD_ID);
    console.log(`[Emoji] Initialized ${rankEmojiCache?.size || 0} rank emojis and ${tetoEmoji ? 'teto' : 'no teto'} emoji`);
  } catch (error) {
    console.error('[Emoji init error]', error.message);
  }
  
  // Try to connect to DB (retries in background, doesn't block bot)
  await waitForDatabase();
});

/** Build context for /rsc and /tc handlers (all dependencies passed to commandHandlers.js) */
function buildRscTcContext() {
  return {
    createEmbed,
    getOperatingChannel,
    associations,
    activeChallenges,
    createAndPostChallenge,
    compareScores,
    extractScoreValue,
    formatBeatmapLink,
    drawChallengeCard,
    getMapTitle,
    getMapArtist,
    formatDifficultyLabel,
    formatStarRating,
    isValidScore,
    resolveMapOrScoreLink,
    getUserBeatmapScore,
    getUserRecentScores,
    getBeatmap,
    getUser,
    AttachmentBuilder,
    EmbedBuilder,
    BOT_EMBED_COLOR,
    getUserBeatmapScoresAll,
    getBeatmapAndLink,
    buildBeatmapLinkFromIds,
    getBeatmapsetImageUrl,
    formatPlayerStats,
    formatPlayerStatsCompact,
    extractBeatmapInfoFromMessage,
    localScores,
    formatTetoText,
    getBeatmapStatusName,
    isScoreSavedOnOsu,
  };
}

/** Build context for /teto handler (setup, link, help, test, map submit). */
function buildTetoContext() {
  return {
    createEmbed,
    getOperatingChannel,
    formatTetoText,
    dbServerConfig,
    associations,
    getUser,
    runTestCommand,
    buildTestContext,
    todayString,
    resolveMapOrScoreLink,
    extractBeatmapId,
    submissions,
    getBeatmapAndLink,
    getBeatmapsetImageUrl,
    formatStarRating,
    formatDifficultyLabel,
    extractOsuProfile,
  };
}

// Interaction handling
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'rsc') {
      return await handleRsc(interaction, buildRscTcContext());
    }

    if (interaction.commandName === 'tc') {
      return await handleTc(interaction, buildRscTcContext());
    }

    if (interaction.commandName === 'trs') {
      return await handleTrs(interaction, buildRscTcContext());
    }

    if (interaction.commandName === 'teto') {
      return await handleTeto(interaction, buildTetoContext());
    }
  } catch (error) {
    console.error(`[Command Error] /${interaction.commandName}:`, error.message);

    const errorMessage = 'Teto is off. Looks like something is wrong. Please contact Koriagami';

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      console.error('[Reply Error]', replyError.message);
    }
  }
});

// Reaction handling - monitor 👎 count
client.on(Events.MessageReactionAdd, (reaction, user) => handleMessageReactionAdd(reaction, user, { createEmbed }));

// Weekly update cron job - runs every Saturday at 16:00 (4 PM)
// Cron expression: "0 16 * * 6" = minute 0, hour 16, any day of month, any month, day 6 (Saturday)
// IMPORTANT: Each guild is processed independently - stats are never mixed between guilds
cron.schedule('0 16 * * 6', async () => {
  console.log('Running weekly update...');
  
  try {
    // Get all guild IDs that have challenges
    const guildIds = await activeChallenges.getAllGuildIds();

    // Process each guild separately to ensure stats are not mixed
    for (const guildId of guildIds) {
      try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) continue;

        const opChannelResult = await getOperatingChannel(guildId, guild, 'challenges');
        if (opChannelResult.error || !opChannelResult.channel) {
          console.log(`Skipping guild ${guildId}: ${opChannelResult.error || 'No challenges channel configured'}`);
          continue;
        }

        const messages = await generateWeeklyUpdate(guildId);
        if (messages && messages.length > 0) {
          // Post messages as embeds (each message is already an array of embeds)
          for (const embedArray of messages) {
            await opChannelResult.channel.send({
              embeds: embedArray,
            });
          }
          console.log(`Weekly update posted for guild ${guildId}`);
        } else {
          console.log(`No weekly update content for guild ${guildId}`);
        }
      } catch (error) {
        console.error(`Error posting weekly update for guild ${guildId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in weekly update cron job:', error);
  }
}, {
  timezone: 'UTC' // Run at 16:00 UTC
});

// DAILY RESET: clean up old submission entries at midnight UTC
// We'll use a minute-based checker to detect when hour=0 and minute=0 (UTC)
let lastResetDate = null;
setInterval(async () => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  if (h === 0 && m === 0 && lastResetDate !== dateStr) {
    // Only remove entries that are not from today (cleanup old data)
    const today = dateStr;
    try {
      const result = await submissions.deleteOldEntries(today);
      if (result.count > 0) {
        console.log(`Daily submission limits reset - ${result.count} old entries cleaned.`);
      }
    } catch (error) {
      console.error('Error cleaning old submissions:', error);
    }
    lastResetDate = dateStr;
  }
}, 60 * 1000); // every minute

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await disconnect();
  process.exit(0);
});

client.login(TOKEN).catch((error) => {
  console.error('❌ Failed to login:', error.message);
  process.exit(1);
});
