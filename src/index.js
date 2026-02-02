import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
  MessageFlags,
  EmbedBuilder,
  AttachmentBuilder,
} from 'discord.js';
import cron from 'node-cron';
import { commands } from './commands.js';
import { extractBeatmapId, getUserRecentScores, getUserBeatmapScore, getUserBeatmapScoresAll, getUser, getBeatmap } from './osu-api.js';
import { serverConfig as dbServerConfig, submissions, associations, activeChallenges, localScores, disconnect, prisma } from './db.js';
import { mockScore, mockScoreSingleMod, mockChallengerScore, createMockResponderScore, mockBeatmap, mockMods, defaultDifficulty, createMockScores, mockRecentPlay1, mockRecentPlay2 } from './test-mock-data.js';
import { drawCardPrototype, drawChallengeCard } from './card.js';

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

// Cache for emojis from parent guild
let rankEmojiCache = null;
let tetoEmoji = null;
let mapStatsEmojiCache = null;

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

// Helper: find and cache emojis from parent guild
async function initializeEmojis() {
  if (rankEmojiCache && tetoEmoji !== null && mapStatsEmojiCache) {
    return { rankEmojiCache, tetoEmoji, mapStatsEmojiCache };
  }
  
  rankEmojiCache = new Map();
  mapStatsEmojiCache = new Map();
  const rankNames = ['F', 'D', 'C', 'B', 'A', 'S', 'SH', 'SS', 'SSH', 'X', 'XH'];
  const mapStatsNames = ['cs', 'ar', 'bpm', 'od', 'hp'];
  
  try {
    let targetGuild = null;
    
    // If PARENT_GUILD_ID is set, use that specific guild
    if (PARENT_GUILD_ID) {
      try {
        targetGuild = await client.guilds.fetch(PARENT_GUILD_ID);
        console.log(`[Emoji] Using parent guild: ${targetGuild.name} (${PARENT_GUILD_ID})`);
      } catch (error) {
        console.error(`[Emoji] Failed to fetch parent guild ${PARENT_GUILD_ID}:`, error);
        console.log(`[Emoji] Falling back to searching all guilds...`);
      }
    }
    
    // If we have a target guild, use it; otherwise search all guilds
    const guildsToSearch = targetGuild ? [targetGuild] : Array.from(client.guilds.cache.values());
    
    for (const guild of guildsToSearch) {
      try {
        const emojis = await guild.emojis.fetch();
        for (const [emojiId, emoji] of emojis) {
          const emojiName = emoji.name?.toLowerCase();
          
          // Cache rank emojis
          if (emojiName && emojiName.startsWith('rank_')) {
            const rankLetter = emojiName.replace('rank_', '').toUpperCase();
            if (rankNames.includes(rankLetter) && !rankEmojiCache.has(rankLetter)) {
              rankEmojiCache.set(rankLetter, emoji);
              console.log(`[Emoji] Found emoji for rank ${rankLetter} from guild ${guild.name}: ${emoji.name} (ID: ${emoji.id})`);
            }
          }
          
          // Cache map stats emojis
          if (emojiName && mapStatsNames.includes(emojiName) && !mapStatsEmojiCache.has(emojiName)) {
            mapStatsEmojiCache.set(emojiName, emoji);
            console.log(`[Emoji] Found emoji for map stat ${emojiName} from guild ${guild.name}: ${emoji.name} (ID: ${emoji.id})`);
          }
          
          // Cache teto emoji
          if (emojiName === 'teto' && !tetoEmoji) {
            tetoEmoji = emoji;
            console.log(`[Emoji] Found teto emoji from guild ${guild.name}: ${emoji.name} (ID: ${emoji.id})`);
          }
        }
        // If we found all emojis, we can stop searching
        if (rankEmojiCache.size === rankNames.length && tetoEmoji && mapStatsEmojiCache.size === mapStatsNames.length) break;
      } catch (error) {
        console.error(`[Emoji] Error fetching emojis from guild ${guild.name}:`, error);
        continue;
      }
    }
    
    if (rankEmojiCache.size > 0) {
      console.log(`[Emoji] Successfully cached ${rankEmojiCache.size} rank emojis`);
    } else {
      console.warn(`[Emoji] No rank emojis found. Make sure emojis named rank_D, rank_C, etc. exist in the parent guild.`);
    }
    
    if (mapStatsEmojiCache.size > 0) {
      console.log(`[Emoji] Successfully cached ${mapStatsEmojiCache.size} map stats emojis`);
    } else {
      console.warn(`[Emoji] No map stats emojis found. Make sure emojis named cs, ar, bpm, od, hp exist in the parent guild.`);
    }
    
    if (tetoEmoji) {
      console.log(`[Emoji] Successfully cached teto emoji`);
    } else {
      console.warn(`[Emoji] No teto emoji found. Make sure an emoji named 'teto' exists in the parent guild.`);
    }
  } catch (error) {
    console.error('[Emoji] Error initializing emojis:', error);
  }
  
  return { rankEmojiCache, tetoEmoji, mapStatsEmojiCache };
}

// Helper: format rank with emoji
async function formatRank(rank) {
  if (!rank || rank === 'N/A') return 'N/A';
  
  const rankUpper = String(rank).toUpperCase();
  
  // Initialize emojis if not already done (lazy initialization)
  if (!rankEmojiCache) {
    await initializeEmojis();
  }
  
  // Try to use cached emoji if available
  if (rankEmojiCache && rankEmojiCache.has(rankUpper)) {
    const emoji = rankEmojiCache.get(rankUpper);
    return emoji.toString(); // Returns <:name:id> format
  }
  
  // Fallback to emoji format (Discord will render if emoji exists in the guild)
  return `:rank_${rankUpper}:`;
}

// Helper: format map stat emoji (cs, ar, bpm, od, hp)
async function formatMapStatEmoji(statName) {
  const statLower = String(statName).toLowerCase();
  
  // Initialize emojis if not already done (lazy initialization)
  if (!mapStatsEmojiCache) {
    await initializeEmojis();
  }
  
  // Try to use cached emoji if available
  if (mapStatsEmojiCache && mapStatsEmojiCache.has(statLower)) {
    const emoji = mapStatsEmojiCache.get(statLower);
    return emoji.toString(); // Returns <:name:id> format
  }
  
  // Fallback to emoji format (Discord will render if emoji exists in the guild)
  return `:${statLower}:`;
}

// Helper: replace "Teto" with emoji + "Teto" in text
async function formatTetoText(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Initialize emojis if not already done (lazy initialization)
  if (tetoEmoji == null) {
    await initializeEmojis();
  }
  
  // Replace "Teto" with emoji + "Teto" (case-sensitive, whole word only)
  // Use word boundary regex to match whole words only
  const tetoRegex = /\bTeto\b/g;
  
  if (tetoEmoji) {
    return text.replace(tetoRegex, `${tetoEmoji.toString()} Teto`);
  }
  
  // Fallback to emoji format if emoji not found
  return text.replace(tetoRegex, `:teto: Teto`);
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

// Helper: extract score value from score object (handles both number and object cases)
function extractScoreValue(score) {
  if (typeof score.score === 'number') {
    return score.score;
  } else if (typeof score.score === 'object' && score.score !== null) {
    return score.score.total || score.score.value || 0;
  }
  return 0;
}

// Helper: create and post a challenge announcement
async function createAndPostChallenge(guildId, userId, osuUserId, userScore, opChannel, interaction) {
  const beatmapId = userScore.beatmap.id.toString();
  const difficulty = userScore.beatmap.version;
  
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

// Helper: format mods from score object
function formatMods(score) {
  if (!score || typeof score !== 'object') return 'No mods';
  
  // Try to get mods from score.mods (array of objects with acronym property)
  if (Array.isArray(score.mods) && score.mods.length > 0) {
    const modAcronyms = score.mods
      .map(mod => (typeof mod === 'object' && mod.acronym) ? mod.acronym : (typeof mod === 'string' ? mod : null))
      .filter(Boolean);
    return modAcronyms.length > 0 ? modAcronyms.join(', ') : 'No mods';
  }
  
  // Try to get mods as a string
  if (typeof score.mods_string === 'string' && score.mods_string.length > 0) {
    return score.mods_string;
  }
  
  // Try legacy format
  if (typeof score.mods === 'string' && score.mods.length > 0) {
    return score.mods;
  }
  
  return 'No mods';
}

// Helper: compare two scores and format comparison table.
// Score objects must come from osu! API v2 (getUserRecentScores, getUserBeatmapScore, etc.) and include:
// pp, accuracy (0–1), max_combo, score, statistics: { count_300, count_100, count_50, count_miss }, beatmap, user.
// Challenge winner: 5 key metrics — PP (or 300s when both PP are 0), Accuracy, Max Combo, Score, Misses.
// Responder wins the challenge if they win 3 or more of these 5 metrics (responderWins >= 3).
// Returns: { table: string, responderWins: number, challengerWins: number, totalMetrics: number, statWinners }
function compareScores(challengerScore, responderScore, responderUsername) {
  // Validate inputs
  if (!challengerScore || !responderScore || typeof challengerScore !== 'object' || typeof responderScore !== 'object') {
    throw new Error('Invalid score data provided for comparison');
  }

  const challengerUsername = challengerScore.user?.username || 'Challenger';
  const responderName = responderUsername;

  // Extract stats
  const challengerPP = challengerScore.pp || 0;
  const responderPP = responderScore.pp || 0;
  const challengerAcc = (challengerScore.accuracy || 0) * 100;
  const responderAcc = (responderScore.accuracy || 0) * 100;
  const challengerCombo = challengerScore.max_combo || 0;
  const responderCombo = responderScore.max_combo || 0;
  const challengerScoreValue = challengerScore.score || 0;
  const responderScoreValue = responderScore.score || 0;
  
  const challenger300 = challengerScore.statistics?.count_300 || 0;
  const responder300 = responderScore.statistics?.count_300 || 0;
  const challenger100 = challengerScore.statistics?.count_100 || 0;
  const responder100 = responderScore.statistics?.count_100 || 0;
  const challenger50 = challengerScore.statistics?.count_50 || 0;
  const responder50 = responderScore.statistics?.count_50 || 0;
  const challengerMiss = challengerScore.statistics?.count_miss || 0;
  const responderMiss = responderScore.statistics?.count_miss || 0;
  
  // Extract mods (for display only, not used in winner calculation)
  const challengerMods = formatMods(challengerScore);
  const responderMods = formatMods(responderScore);

  // Fifth metric for challenge: PP normally; when both PP are 0, use 300s so we still have 5 comparable metrics
  const bothPPZero = challengerPP == 0 && responderPP == 0;
  const ppWinner = responderPP > challengerPP ? responderName : (responderPP < challengerPP ? challengerUsername : 'Tie');
  const accWinner = responderAcc > challengerAcc ? responderName : (responderAcc < challengerAcc ? challengerUsername : 'Tie');
  const comboWinner = responderCombo > challengerCombo ? responderName : (responderCombo < challengerCombo ? challengerUsername : 'Tie');
  const scoreWinner = responderScoreValue > challengerScoreValue ? responderName : (responderScoreValue < challengerScoreValue ? challengerUsername : 'Tie');
  const missWinner = responderMiss < challengerMiss ? responderName : (responderMiss > challengerMiss ? challengerUsername : 'Tie');
  const fifthMetricWinner = bothPPZero
    ? (responder300 > challenger300 ? responderName : (responder300 < challenger300 ? challengerUsername : 'Tie'))
    : ppWinner;

  // Format comparison table
  let table = '```\n';
  table += 'Stat              | Challenger          | Responder\n';
  table += '------------------|---------------------|-------------------\n';
  table += `PP                | ${challengerPP.toFixed(2).padStart(17)} ${!bothPPZero && responderPP < challengerPP ? '🏆' : ''} | ${responderPP.toFixed(2).padStart(17)} ${!bothPPZero && responderPP > challengerPP ? '🏆' : ''}\n`;
  table += `Accuracy          | ${challengerAcc.toFixed(2).padStart(16)}% ${responderAcc < challengerAcc ? '🏆' : ''} | ${responderAcc.toFixed(2).padStart(16)}% ${responderAcc > challengerAcc ? '🏆' : ''}\n`;
  table += `Max Combo         | ${challengerCombo.toString().padStart(17)} ${responderCombo < challengerCombo ? '🏆' : ''} | ${responderCombo.toString().padStart(17)} ${responderCombo > challengerCombo ? '🏆' : ''}\n`;
  table += `Score             | ${challengerScoreValue.toLocaleString().padStart(17)} ${responderScoreValue < challengerScoreValue ? '🏆' : ''} | ${responderScoreValue.toLocaleString().padStart(17)} ${responderScoreValue > challengerScoreValue ? '🏆' : ''}\n`;
  table += `Misses            | ${challengerMiss.toString().padStart(17)} ${responderMiss > challengerMiss ? '🏆' : ''} | ${responderMiss.toString().padStart(17)} ${responderMiss < challengerMiss ? '🏆' : ''}\n`;
  table += `300s              | ${challenger300.toString().padStart(17)} ${bothPPZero && responder300 < challenger300 ? '🏆' : ''} | ${responder300.toString().padStart(17)} ${bothPPZero && responder300 > challenger300 ? '🏆' : ''}\n`;
  table += `100s              | ${challenger100.toString().padStart(17)} | ${responder100.toString().padStart(17)}\n`;
  table += `50s               | ${challenger50.toString().padStart(17)} | ${responder50.toString().padStart(17)}\n`;
  // Truncate mods if too long (max 17 chars to fit column width)
  const challengerModsFormatted = challengerMods.length > 17 ? challengerMods.substring(0, 14) + '...' : challengerMods;
  const responderModsFormatted = responderMods.length > 17 ? responderMods.substring(0, 14) + '...' : responderMods;
  table += `Mods              | ${challengerModsFormatted.padStart(17)} | ${responderModsFormatted.padStart(17)}\n`;
  table += '```\n\n';

  // Summary: 5 key metrics — PP (or 300s when both PP are 0), Accuracy, Max Combo, Score, Misses. Winner needs 3+ of 5.
  let challengerWins = 0;
  let responderWins = 0;
  if (fifthMetricWinner === challengerUsername) challengerWins++; else if (fifthMetricWinner === responderName) responderWins++;
  if (accWinner === challengerUsername) challengerWins++; else if (accWinner === responderName) responderWins++;
  if (comboWinner === challengerUsername) challengerWins++; else if (comboWinner === responderName) responderWins++;
  if (scoreWinner === challengerUsername) challengerWins++; else if (scoreWinner === responderName) responderWins++;
  if (missWinner === challengerUsername) challengerWins++; else if (missWinner === responderName) responderWins++;

  const totalMetrics = challengerWins + responderWins; // Ties don't count
  table += `**Winner:** ${responderWins > challengerWins ? responderName : responderWins < challengerWins ? challengerUsername : 'Tie'} (${Math.max(responderWins, challengerWins)}/${totalMetrics} stats)`;

  // Per-stat winner for card: order Mods(0), PP(1), Accuracy(2), Max combo(3), Score(4), Misses(5), 300s(6), 100s(7), 50s(8). 'left'=champion, 'right'=responder, 'tie'
  const statWinners = [
    'tie', // Mods
    responderPP > challengerPP ? 'right' : responderPP < challengerPP ? 'left' : 'tie',
    responderAcc > challengerAcc ? 'right' : responderAcc < challengerAcc ? 'left' : 'tie',
    responderCombo > challengerCombo ? 'right' : responderCombo < challengerCombo ? 'left' : 'tie',
    responderScoreValue > challengerScoreValue ? 'right' : responderScoreValue < challengerScoreValue ? 'left' : 'tie',
    responderMiss < challengerMiss ? 'right' : responderMiss > challengerMiss ? 'left' : 'tie',
    responder300 > challenger300 ? 'right' : responder300 < challenger300 ? 'left' : 'tie',
    responder100 < challenger100 ? 'right' : responder100 > challenger100 ? 'left' : 'tie', // less is better
    responder50 < challenger50 ? 'right' : responder50 > challenger50 ? 'left' : 'tie',   // less is better
  ];

  return {
    table,
    responderWins,
    challengerWins,
    totalMetrics,
    statWinners,
  };
}

// Helper: format beatmap link from score object
function formatBeatmapLink(score) {
  const beatmapId = score.beatmap?.id;
  const beatmapsetId = score.beatmap?.beatmapset_id;
  
  if (beatmapsetId && beatmapId) {
    return `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
  } else if (beatmapId) {
    return `https://osu.ppy.sh/beatmaps/${beatmapId}`;
  }
  return null;
}

// Helper: get beatmapset image URL from score object or beatmap data
// Returns the card image URL (good size for Discord embeds)
async function getBeatmapsetImageUrl(scoreOrBeatmap) {
  try {
    // Try to get beatmapset ID from score object
    let beatmapsetId = scoreOrBeatmap?.beatmap?.beatmapset_id 
      || scoreOrBeatmap?.beatmapset_id
      || scoreOrBeatmap?.beatmapset?.id;
    
    // If we have beatmapset ID, construct the image URL
    if (beatmapsetId) {
      return `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/card.jpg`;
    }
    
    // If we have a beatmap ID but no beatmapset ID, fetch the beatmap
    const beatmapId = scoreOrBeatmap?.beatmap?.id || scoreOrBeatmap?.id;
    if (beatmapId) {
      try {
        const beatmap = await getBeatmap(beatmapId);
        beatmapsetId = beatmap?.beatmapset_id || beatmap?.beatmapset?.id;
        if (beatmapsetId) {
          return `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/card.jpg`;
        }
      } catch (error) {
        console.error('Error fetching beatmap for image URL:', error);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting beatmapset image URL:', error);
    return null;
  }
}

// Helper: validate score object has required structure
function isValidScore(score) {
  if (!score || typeof score !== 'object') {
    return false;
  }
  
  // Must have beatmap with id
  if (!score.beatmap || !score.beatmap.id) {
    return false;
  }
  
  // Must have a valid score value (number)
  if (typeof score.score !== 'number') {
    return false;
  }
  
  // Must have beatmap version (difficulty name)
  if (!score.beatmap.version) {
    return false;
  }
  
  return true;
}

// Helper: get map title from score object or fetch beatmap if needed
async function getMapTitle(score) {
  // Try multiple possible paths in the score object
  const title = score.beatmap?.beatmapset?.title 
    || score.beatmap?.beatmapset?.title_unicode
    || score.beatmapset?.title
    || score.beatmapset?.title_unicode;
  
  if (title) {
    return title;
  }
  
  // If not found, fetch the beatmap to get the title
  const beatmapId = score.beatmap?.id;
  if (beatmapId) {
    try {
      const beatmap = await getBeatmap(beatmapId);
      return beatmap.beatmapset?.title || beatmap.beatmapset?.title_unicode || 'Unknown Map';
    } catch (error) {
      console.error('Error fetching beatmap for title:', error);
      return 'Unknown Map';
    }
  }
  
  return 'Unknown Map';
}

// Helper: get map artist from score or beatmap object (or fetch beatmap if needed)
async function getMapArtist(scoreOrBeatmap) {
  if (!scoreOrBeatmap) return '';
  const artist = scoreOrBeatmap.beatmap?.beatmapset?.artist
    || scoreOrBeatmap.beatmap?.beatmapset?.artist_unicode
    || scoreOrBeatmap.beatmapset?.artist
    || scoreOrBeatmap.beatmapset?.artist_unicode;
  if (artist) return artist;
  const beatmapId = scoreOrBeatmap.beatmap?.id || scoreOrBeatmap?.id;
  if (beatmapId) {
    try {
      const beatmap = await getBeatmap(beatmapId);
      return beatmap?.beatmapset?.artist || beatmap?.beatmapset?.artist_unicode || '';
    } catch (error) {
      console.error('Error fetching beatmap for artist:', error);
    }
  }
  return '';
}

// Helper: get star rating from score/beatmap object (with mod adjustments if available)
// Note: The osu! API v2 doesn't provide mod-adjusted star ratings directly.
// Score objects from the API typically contain the base difficulty_rating.
// To get accurate mod-adjusted star ratings, we would need to calculate them using
// specialized libraries (e.g., rosu-pp for Rust, peace-performance for Python).
// For now, we display the base star rating.
async function getStarRating(scoreOrBeatmap) {
  // Try to get star rating from various possible locations
  // For score objects, check score.beatmap.difficulty_rating first
  // (Note: This is typically the base rating, not mod-adjusted)
  let starRating = scoreOrBeatmap?.beatmap?.difficulty_rating 
    || scoreOrBeatmap?.beatmap?.stars
    || scoreOrBeatmap?.difficulty_rating
    || scoreOrBeatmap?.stars
    || null;
  
  // If not found and we have a beatmap ID, fetch the beatmap
  if (starRating == null && scoreOrBeatmap?.beatmap?.id) {
    try {
      const beatmap = await getBeatmap(scoreOrBeatmap.beatmap.id);
      starRating = beatmap?.difficulty_rating || beatmap?.stars || null;
    } catch (error) {
      console.error('Error fetching beatmap for star rating:', error);
    }
  }
  
  // TODO: To show mod-adjusted star ratings, we would need to:
  // 1. Extract mods from the score object
  // 2. Use a library like rosu-pp (via a Node.js binding) or call an external service
  // 3. Calculate the mod-adjusted star rating based on the mods applied
  // For now, we return the base star rating
  
  return starRating;
}

// Helper: format star rating as bold text (separate from link)
async function formatStarRating(scoreOrBeatmap) {
  if (!scoreOrBeatmap) return '';
  
  const starRating = await getStarRating(scoreOrBeatmap);
  if (starRating != null) {
    const starRatingFormatted = starRating.toFixed(2);
    return `**:star: ${starRatingFormatted}** `;
  }
  return '';
}

// Helper: format difficulty label (without star rating). Format: "artist - map name [difficulty]"
function formatDifficultyLabel(mapTitle, difficulty, artist = '') {
  if (artist && String(artist).trim()) {
    return `${artist.trim()} - ${mapTitle} [${difficulty}]`;
  }
  return `${mapTitle} [${difficulty}]`;
}

// Helper: format player stats from score object
async function formatPlayerStats(score) {
  // Safely extract score value
  const scoreValue = extractScoreValue(score);
  
  const rank = score.rank || 'N/A';
  const rankFormatted = await formatRank(rank);
  const mods = formatMods(score);
  const pp = typeof score.pp === 'number' ? score.pp : 0;
  const accuracy = typeof score.accuracy === 'number' ? (score.accuracy * 100) : 0;
  const maxCombo = typeof score.max_combo === 'number' ? score.max_combo : 0;
  const count300 = score.statistics?.count_300 || 0;
  const count100 = score.statistics?.count_100 || 0;
  const count50 = score.statistics?.count_50 || 0;
  const countMiss = score.statistics?.count_miss || 0;
  
  // Get map stats (CS, AR, BPM, OD, HP) from beatmap
  let cs = score.beatmap?.cs ?? score.beatmap?.circle_size ?? null;
  let ar = score.beatmap?.ar ?? score.beatmap?.approach_rate ?? null;
  let bpm = score.beatmap?.bpm ?? null;
  let od = score.beatmap?.accuracy ?? score.beatmap?.overall_difficulty ?? null;
  let hp = score.beatmap?.drain ?? score.beatmap?.hp ?? score.beatmap?.health ?? null;
  
  // If map stats are not in score object, try to fetch beatmap
  // Check if any stat is missing (null or undefined)
  const needsFetch = cs == null || ar == null || bpm == null || od == null || hp == null;
  
  if (needsFetch && score.beatmap?.id) {
    try {
      const beatmap = await getBeatmap(score.beatmap.id);
      // Use nullish coalescing to only set if current value is null/undefined
      cs = cs ?? beatmap?.cs ?? beatmap?.circle_size ?? null;
      ar = ar ?? beatmap?.ar ?? beatmap?.approach_rate ?? null;
      bpm = bpm ?? beatmap?.bpm ?? null;
      od = od ?? beatmap?.accuracy ?? beatmap?.overall_difficulty ?? null;
      hp = hp ?? beatmap?.drain ?? beatmap?.hp ?? beatmap?.health ?? null;
      
    } catch (error) {
      console.error('Error fetching beatmap for map stats:', error);
    }
  }
  
  let stats = `**Score Stats:**\n`;
  stats += `• Rank: ${rankFormatted} | ${mods}\n`;
  stats += `• PP: **${pp.toFixed(2)}**\n`;
  stats += `• Accuracy: **${accuracy.toFixed(2)}%**\n`;
  stats += `• Max Combo: **${maxCombo.toLocaleString()}**\n`;
  stats += `• Score: **${scoreValue.toLocaleString()}**\n`;
  stats += `• Hits: **${count300}**/${count100}/${count50}/**${countMiss}**\n`;
  
  // Add Map Stats line if we have the data
  if (cs != null || ar != null || bpm != null || od != null || hp != null) {
    const csValue = cs != null ? cs.toFixed(1) : 'N/A';
    const arValue = ar != null ? ar.toFixed(1) : 'N/A';
    const bpmValue = bpm != null ? Math.round(bpm).toString() : 'N/A';
    const odValue = od != null ? od.toFixed(1) : 'N/A';
    const hpValue = hp != null ? hp.toFixed(1) : 'N/A';
    const csEmoji = await formatMapStatEmoji('cs');
    const arEmoji = await formatMapStatEmoji('ar');
    const bpmEmoji = await formatMapStatEmoji('bpm');
    const odEmoji = await formatMapStatEmoji('od');
    const hpEmoji = await formatMapStatEmoji('hp');
    stats += `• Map Stats: ${csEmoji} **${csValue}** | ${arEmoji} **${arValue}** | ${bpmEmoji} **${bpmValue}** | ${odEmoji} **${odValue}** | ${hpEmoji} **${hpValue}**\n`;
  }
  
  stats += '\n';
  
  return stats;
}

// Helper: format player stats in compact one-line format
async function formatPlayerStatsCompact(score) {
  // Safely extract score value
  const scoreValue = extractScoreValue(score);
  
  const rank = score.rank || 'N/A';
  const rankFormatted = await formatRank(rank);
  const mods = formatMods(score);
  const pp = typeof score.pp === 'number' ? score.pp : 0;
  const accuracy = typeof score.accuracy === 'number' ? (score.accuracy * 100) : 0;
  const maxCombo = typeof score.max_combo === 'number' ? score.max_combo : 0;
  const count300 = score.statistics?.count_300 || 0;
  const count100 = score.statistics?.count_100 || 0;
  const count50 = score.statistics?.count_50 || 0;
  const countMiss = score.statistics?.count_miss || 0;
  
  return `${rankFormatted} | ${mods} | ${pp.toFixed(2)}pp | ${accuracy.toFixed(2)}% | ${maxCombo.toLocaleString()}x | ${scoreValue.toLocaleString()} | ${count300}/${count100}/${count50}/${countMiss}`;
}

// Helper: get beatmap status name from status number
function getBeatmapStatusName(status) {
  // Handle both numeric and string status values
  const statusStr = String(status).toLowerCase();
  
  // Map string status names to display names
  const stringStatusMap = {
    'graveyard': 'Graveyard',
    'wip': 'WIP',
    'pending': 'Pending',
    'ranked': 'Ranked',
    'approved': 'Approved',
    'qualified': 'Qualified',
    'loved': 'Loved',
  };
  
  // Check string status first
  if (stringStatusMap[statusStr]) {
    return stringStatusMap[statusStr];
  }
  
  // Fallback to numeric status mapping
  const statusMap = {
    '-2': 'Graveyard',
    '-1': 'WIP',
    '0': 'Pending',
    '1': 'Ranked',
    '2': 'Approved',
    '3': 'Qualified',
    '4': 'Loved',
  };
  return statusMap[String(status)] || 'Unknown';
}

// Helper: check if beatmap status saves scores to osu! servers
// Returns true for: Ranked (1), Approved (2), Qualified (3), Loved (4)
// Returns false for: Graveyard (-2), WIP (-1), Pending (0)
function isScoreSavedOnOsu(status) {
  // Handle string status names
  const statusStr = String(status).toLowerCase();
  if (['ranked', 'approved', 'qualified', 'loved'].includes(statusStr)) {
    return true;
  }
  if (['graveyard', 'wip', 'pending'].includes(statusStr)) {
    return false;
  }
  
  // Fallback to numeric check
  const statusNum = typeof status === 'string' ? parseInt(status, 10) : status;
  return statusNum >= 1 && statusNum <= 4;
}

// Helper: extract beatmap ID and difficulty from a message
// Strategy: Find all osu.ppy.sh links first, then find the first beatmap difficulty link
// and extract difficulty from its context
// Handles formats like: [Map Title [Difficulty]](link) or **Map Title [Difficulty]** with plain link
// Returns: { beatmapId: string, difficulty: string } or null
function extractBeatmapInfoFromMessage(messageContent) {
  if (!messageContent) return null;

  // Step 1: Find all osu.ppy.sh links (both markdown and plain)
  const foundLinks = [];
  
  // Find markdown links: [text](url)
  let bracketStart = -1;
  let bracketCount = 0;
  for (let i = 0; i < messageContent.length; i++) {
    if (messageContent[i] === '[') {
      if (bracketCount === 0) bracketStart = i;
      bracketCount++;
    } else if (messageContent[i] === ']') {
      bracketCount--;
      if (bracketCount === 0 && bracketStart !== -1) {
        // Found a complete bracket pair, check if it's followed by (link)
        if (i + 1 < messageContent.length && messageContent[i + 1] === '(') {
          // This might be a markdown link, find the closing )
          let parenCount = 1;
          let j = i + 2;
          while (j < messageContent.length && parenCount > 0) {
            if (messageContent[j] === '(') parenCount++;
            else if (messageContent[j] === ')') parenCount--;
            j++;
          }
          if (parenCount === 0) {
            // Found a markdown link: [text](url)
            const linkText = messageContent.substring(bracketStart + 1, i);
            const linkUrl = messageContent.substring(i + 2, j - 1);
            
            // Check if it's an osu.ppy.sh link
            if (linkUrl.includes('osu.ppy.sh')) {
              foundLinks.push({
                type: 'markdown',
                linkText: linkText,
                linkUrl: linkUrl,
                linkStart: bracketStart,
                linkEnd: j - 1
              });
            }
          }
        }
        bracketStart = -1;
      }
    }
  }
  
  // Find plain links: https://osu.ppy.sh/...
  const plainLinkRegex = /https?:\/\/osu\.ppy\.sh\/[^\s\)]+/g;
  const plainLinkMatches = messageContent.matchAll(plainLinkRegex);
  for (const match of plainLinkMatches) {
    foundLinks.push({
      type: 'plain',
      linkText: null,
      linkUrl: match[0],
      linkStart: match.index,
      linkEnd: match.index + match[0].length
    });
  }
  
  // Sort links by position in message (first to last)
  foundLinks.sort((a, b) => a.linkStart - b.linkStart);
  
  // Step 2: Find the first link that is a beatmap difficulty link
  // Only accept short format (/b/) or full beatmapset format (/beatmapsets/{set_id}#{mode}/{beatmap_id})
  for (const linkInfo of foundLinks) {
    const url = linkInfo.linkUrl;
    
    // Check if link is in the accepted formats for /tc
    // Format 1: Short format - https://osu.ppy.sh/b/{beatmap_id}
    const isShortFormat = /osu\.ppy\.sh\/b\/\d+/.test(url);
    // Format 2: Full beatmapset format - https://osu.ppy.sh/beatmapsets/{set_id}#{mode}/{beatmap_id}
    const isFullBeatmapsetFormat = /beatmapsets\/\d+#\w+\/\d+/.test(url);
    
    // Only process if it's one of the accepted formats
    if (!isShortFormat && !isFullBeatmapsetFormat) {
      continue; // Skip links that aren't in the accepted formats
    }
    
    const beatmapId = extractBeatmapId(url);
    if (!beatmapId) {
      continue; // Skip if we can't extract beatmap ID
    }
    
    // Step 3: Extract difficulty from the link's context
    let difficulty = null;
    
    if (linkInfo.type === 'markdown') {
      // For markdown links, difficulty is in the link text: "Map Title [Difficulty]"
      const linkText = linkInfo.linkText;
      const lastBracketEnd = linkText.lastIndexOf(']');
      if (lastBracketEnd !== -1 && lastBracketEnd > 0) {
        // Find the matching [ by working backwards
        let diffBracketCount = 1;
        let pos = lastBracketEnd - 1;
        while (pos >= 0 && diffBracketCount > 0) {
          if (linkText[pos] === ']') diffBracketCount++;
          else if (linkText[pos] === '[') diffBracketCount--;
          pos--;
        }
        if (diffBracketCount === 0 && pos >= -1) {
          // Found matching bracket pair
          difficulty = linkText.substring(pos + 2, lastBracketEnd);
        }
      }
    } else {
      // For plain links, look for difficulty in brackets near the link
      // Search in a window around the link (before and after)
      const searchStart = Math.max(0, linkInfo.linkStart - 200);
      const searchEnd = Math.min(messageContent.length, linkInfo.linkEnd + 200);
      const searchArea = messageContent.substring(searchStart, searchEnd);
      
      // Find all bracket pairs in the search area
      const allBrackets = [];
      let bracketStart = -1;
      let bracketCount = 0;
      for (let i = 0; i < searchArea.length; i++) {
        if (searchArea[i] === '[') {
          if (bracketCount === 0) bracketStart = i;
          bracketCount++;
        } else if (searchArea[i] === ']') {
          bracketCount--;
          if (bracketCount === 0 && bracketStart !== -1) {
            const bracketContent = searchArea.substring(bracketStart + 1, i);
            // Check if this is not part of a markdown link (not followed by ()
            const nextChar = searchArea[i + 1];
            if (nextChar !== '(') {
              allBrackets.push({ content: bracketContent, position: searchStart + bracketStart });
            }
            bracketStart = -1;
          }
        }
      }
      
      // Take the bracket closest to the link (prefer before the link)
      if (allBrackets.length > 0) {
        // Sort by distance from link start (prefer before link)
        allBrackets.sort((a, b) => {
          const distA = Math.abs(a.position - (linkInfo.linkStart - searchStart));
          const distB = Math.abs(b.position - (linkInfo.linkStart - searchStart));
          return distA - distB;
        });
        difficulty = allBrackets[0].content;
      }
    }
    
    // Return beatmapId if found, even if difficulty is not found
    // The caller can fetch the beatmap to get the difficulty if needed
    if (beatmapId) {
      return { beatmapId, difficulty: difficulty || null };
    }
  }

  return null;
}

// Helper: extract OSU username/user ID from profile link
// Requires "osu.ppy.sh/users/" format
function extractOsuProfile(profileLink) {
  if (!profileLink) return null;

  // Must contain "osu.ppy.sh/users/" in the link
  if (!profileLink.includes('osu.ppy.sh/users/')) {
    return null;
  }

  // Try /users/{id} format (numeric ID)
  const usersMatch = profileLink.match(/osu\.ppy\.sh\/users\/(\d+)/);
  if (usersMatch) {
    return { userId: usersMatch[1], username: null, profileLink };
  }

  // Try /users/{username} format (non-numeric username)
  // Match anything that's not all digits
  const usernameMatch = profileLink.match(/osu\.ppy\.sh\/users\/([^\/\?#]+)/);
  if (usernameMatch && !/^\d+$/.test(usernameMatch[1])) {
    return { userId: null, username: usernameMatch[1], profileLink };
  }

  return null;
}

// Test command functions (read-only, no data modification)
async function testTrsCommand(interaction, guildId) {
  // Get a random local score or create mock data
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
    const difficultyLabel = formatDifficultyLabel(mapTitle, difficulty, artist);
    const starRatingText = await formatStarRating(testScore);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    // Simulate beatmap status check (like real /trs)
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

async function testTcCommand(interaction, guildId) {
  // Get a random local score or create mock data
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

    // Create multiple scores with varying stats (like real /tc command)
    const testScores = createMockScores(baseScore, 3);

    const beatmapLink = formatBeatmapLink(testScores[0]);
    const mapTitle = await getMapTitle(testScores[0]);
    const artist = await getMapArtist(testScores[0]);
    const difficulty = testScores[0].beatmap?.version || defaultDifficulty;
    const difficultyLabel = formatDifficultyLabel(mapTitle, difficulty, artist);
    const starRatingText = await formatStarRating(testScores[0]);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    let message = `**[TEST MODE]** Your scores on ${difficultyLink}:\n\n`;

    // First score: full format (enhance with beatmap data if needed)
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

    // Subsequent scores: compact format
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

async function testRscIssueCommand(interaction, guildId) {
  // Get a random challenge or create mock data
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
    const difficultyLabel = formatDifficultyLabel(mapTitle, difficulty, artist);
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

async function testRscRespondCommand(interaction, guildId) {
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
    const difficultyLabel = formatDifficultyLabel(mapTitle, difficulty, artist);
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
        ? `\n\n🏆 **${displayName} has improved the score! The stakes are higher now!** ${statsLine} 🏆`
        : `\n\n😅 **${displayName} has failed to improve the score. Let's pretend Teto didn't see that...**`;
    } else {
      statusMessage = responderWon
        ? `\n\n🏆 **${displayName} has won the challenge and is now the new champion!** ${statsLine} 🏆`
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

async function testMotdCommand(interaction, guildId) {
  // Use real map link for testing
  try {
    const mapLink = 'https://osu.ppy.sh/beatmapsets/1322944#osu/2988681';
    
    // Get beatmap data to format message with map name and difficulty
    let mapName = null;
    let difficultyName = null;
    let difficultyLink = mapLink; // Fallback to original link if we can't get beatmap data
    let imageUrl = null;
    let beatmap = null;
    
    try {
      const beatmapId = extractBeatmapId(mapLink);
      if (beatmapId) {
        beatmap = await getBeatmap(beatmapId);
        mapName = beatmap?.beatmapset?.title || beatmap?.beatmapset?.title_unicode || null;
        difficultyName = beatmap?.version || null;
        imageUrl = await getBeatmapsetImageUrl(beatmap);
        
        // Construct difficulty link
        const beatmapsetId = beatmap?.beatmapset_id || beatmap?.beatmapset?.id;
        if (beatmapsetId && beatmapId) {
          difficultyLink = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
        } else if (beatmapId) {
          difficultyLink = `https://osu.ppy.sh/beatmaps/${beatmapId}`;
        }
      }
    } catch (error) {
      console.error('Error getting beatmap data for test motd:', error);
      // Continue with fallback link if there's an error
    }

    // Format message with map name and difficulty as link (with star rating)
    const artist = beatmap?.beatmapset?.artist || beatmap?.beatmapset?.artist_unicode || '';
    let difficultyLabel = null;
    if (mapName && difficultyName) {
      const labelWithStar = formatDifficultyLabel(mapName, difficultyName, artist);
      difficultyLabel = `[${labelWithStar}](${difficultyLink})`;
    } else if (difficultyName) {
      const labelWithStar = formatDifficultyLabel('Unknown Map', difficultyName, artist);
      difficultyLabel = `[${labelWithStar}](${difficultyLink})`;
    } else {
      difficultyLabel = difficultyLink; // Fallback to plain link
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

async function testReportCommand(interaction, guildId) {
  // Use the actual generateWeeklyUpdate function but don't post to channel
  try {
    // Get challenges channel for validation
    const opChannelResult = await getOperatingChannel(guildId, interaction.guild, 'challenges');
    if (opChannelResult.error || !opChannelResult.channel) {
      return interaction.editReply({ 
        embeds: await createEmbed(opChannelResult.error || 'Challenges channel is not configured. Use `/teto setup` to configure it.'),
        ephemeral: true 
      });
    }

    // Generate weekly update report (read-only, uses real data)
    const messages = await generateWeeklyUpdate(guildId);
    
    if (messages && messages.length > 0) {
      // Return the report as embeds (don't post to channel in test mode)
      const allEmbeds = messages.flat();
      // Discord allows max 10 embeds per message, so we need to split if needed
      const embedChunks = [];
      for (let i = 0; i < allEmbeds.length; i += 10) {
        embedChunks.push(allEmbeds.slice(i, i + 10));
      }

      // Send first chunk as reply
      if (embedChunks.length > 0) {
        await interaction.editReply({ 
          embeds: embedChunks[0],
          content: '**[TEST MODE]** Weekly challenges report preview:'
        });

        // Send remaining chunks as follow-ups if any
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

async function testCardCommand(interaction, guildId) {
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

    // Prefer API username; fallback to stored osuUsername from link, then generic label
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

// When ready
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  // Initialize emojis from guilds
  await initializeEmojis();
  console.log(`[Emoji] Initialized ${rankEmojiCache?.size || 0} rank emojis and ${tetoEmoji ? 'teto' : 'no teto'} emoji`);
});

// Interaction handling
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Handle /rsc command
  if (interaction.commandName === 'rsc') {
    await interaction.deferReply({ ephemeral: false });

    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        return interaction.editReply({ 
          embeds: await createEmbed('This command can only be used in a server.'),
          ephemeral: true 
        });
      }
      const userId = interaction.user.id;
      const respondForMapLink = interaction.options.getString('respond_for_map_link');

      // Get operational channel for challenge announcements
      const opChannelResult = await getOperatingChannel(guildId, interaction.guild, 'challenges');
      if (opChannelResult.error) {
        return interaction.editReply({ 
          embeds: await createEmbed(opChannelResult.error),
          ephemeral: true 
        });
      }
      const opChannel = opChannelResult.channel;

      // Check if user has association
      const association = await associations.get(guildId, userId);
      if (!association || !association.osuUserId) {
        return interaction.editReply({ 
          embeds: await createEmbed('You need to link your Discord profile to your OSU! profile first. Use `/teto link` command to do so.'),
          ephemeral: true 
        });
      }

      const osuUserId = association.osuUserId;
      let beatmapId, difficulty, userScore, existingChallenge;

      // PART A: Issuing a challenge
      if (!respondForMapLink) {
        // Get most recent score
        const recentScoresData = await getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
        // OSU API returns array directly for user scores
        const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];
        
        if (!recentScores || recentScores.length === 0) {
          return interaction.editReply({ 
            embeds: await createEmbed('You have no recent scores. Play a map first!'),
            ephemeral: true 
          });
        }

        userScore = recentScores[0];
        
        // Validate score object
        if (!isValidScore(userScore)) {
          return interaction.editReply({ 
            embeds: await createEmbed('Invalid score data received from OSU API. Please play a map first and try again.'),
            ephemeral: true 
          });
        }

        beatmapId = userScore.beatmap.id.toString();
        difficulty = userScore.beatmap.version;

        // Check if challenge already exists
        existingChallenge = await activeChallenges.getByDifficulty(guildId, beatmapId, difficulty);
        
        if (existingChallenge) {
          // Challenge exists, proceed to PART B
          const mapTitle = await getMapTitle(userScore);
          const artist = await getMapArtist(userScore);
          const difficultyLabel = formatDifficultyLabel(mapTitle, difficulty, artist);
          const starRatingText = await formatStarRating(userScore);
          await interaction.editReply({ 
            embeds: await createEmbed(`There is already an active challenge for ${starRatingText}**${difficultyLabel}**.\nORA ORA! WE ARE ENTERING THE COMPETITION!`)
          });
          // Continue to PART B below
        } else {
          const { difficultyLink, imageUrl } = await createAndPostChallenge(
            guildId, userId, osuUserId, userScore, opChannel, interaction
          );

          return interaction.editReply({ 
            embeds: await createEmbed(`Challenge issued for ${difficultyLink}!`, imageUrl)
          });
        }
      } else {
        // With param - check if link contains osu.ppy.sh
        if (!respondForMapLink.includes('osu.ppy.sh')) {
          return interaction.editReply({ 
          embeds: await createEmbed('Invalid map link. The link must contain "osu.ppy.sh".'),
            ephemeral: true 
          });
        }

        beatmapId = extractBeatmapId(respondForMapLink);
        if (!beatmapId) {
          return interaction.editReply({ 
            embeds: await createEmbed('Could not extract beatmap ID from the link.'),
            ephemeral: true 
          });
        }

        // Try to get user's best/top score for this beatmap first
        userScore = await getUserBeatmapScore(beatmapId, osuUserId);
        
        // If best score fetch failed, fallback to most recent score
        if (!userScore) {
          const recentScoresData = await getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
          const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];
          
          if (!recentScores || recentScores.length === 0) {
            return interaction.editReply({ 
              embeds: await createEmbed('You have no score for this beatmap. Play it first!'),
              ephemeral: true 
            });
          }
          
          userScore = recentScores[0];
          
          // Check if the recent score is for the correct beatmap
          if (userScore.beatmap?.id?.toString() !== beatmapId) {
            return interaction.editReply({ 
              embeds: await createEmbed('You have no score for this beatmap. Play it first!'),
              ephemeral: true 
            });
          }
        }
        
        if (!isValidScore(userScore)) {
          return interaction.editReply({ 
            embeds: await createEmbed('Invalid score data received from OSU API. Please try again.'),
            ephemeral: true 
          });
        }

        difficulty = userScore.beatmap.version;

        // Check if challenge exists
        existingChallenge = await activeChallenges.getByDifficulty(guildId, beatmapId, difficulty);
        
        if (!existingChallenge) {
          const { difficultyLink, imageUrl, difficultyLabel } = await createAndPostChallenge(
            guildId, userId, osuUserId, userScore, opChannel, interaction
          );

          return interaction.editReply({ 
            embeds: await createEmbed(`Huh? Looks like we are uncontested on **${difficultyLabel}**! COME AND CHALLENGE US!`, imageUrl)
          });
        } else {
          // Challenge exists, proceed to PART B
          await interaction.editReply({ 
            embeds: await createEmbed('ORA ORA! WE ARE ENTERING THE COMPETITION!')
          });
          // Continue to PART B below
        }
      }

      // PART B: Responding to challenge OR creating new challenge if none exists
      // If no existing challenge, create a new one using the score we have
      if (!existingChallenge) {
        // We have userScore from PART A, use it to create a new challenge
        if (!userScore || !isValidScore(userScore)) {
          return interaction.editReply({ 
            embeds: await createEmbed('No valid score found. Please try again.'),
            ephemeral: true 
          });
        }
        
        const { difficultyLink, imageUrl } = await createAndPostChallenge(
          guildId, userId, osuUserId, userScore, opChannel, interaction
        );

        return interaction.editReply({ 
          embeds: await createEmbed(`Challenge issued for ${difficultyLink}!`, imageUrl)
        });
      }

      // Get responder's score for the challenge beatmap
      // If we don't have it yet (responding without param), use most recent score
      // If we have a link (responding with param), try best score first, then fallback to most recent
      let responderScore = userScore;
      if (!responderScore || responderScore.beatmap?.id?.toString() !== existingChallenge.beatmapId) {
        // If link was provided, try best score first, then fallback to most recent
        if (respondForMapLink) {
          // Try to get user's best/top score for this beatmap first
          responderScore = await getUserBeatmapScore(existingChallenge.beatmapId, osuUserId);
          
          // If best score fetch failed, fallback to most recent score
          if (!responderScore) {
            const recentScoresData = await getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
            const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];
            
            if (!recentScores || recentScores.length === 0) {
              return interaction.editReply({ 
                embeds: await createEmbed('You have no score for this beatmap. Play it first!'),
                ephemeral: true 
              });
            }
            
            responderScore = recentScores[0];
            
            // Check if the recent score is for the correct beatmap
            if (responderScore.beatmap?.id?.toString() !== existingChallenge.beatmapId) {
              return interaction.editReply({ 
                embeds: await createEmbed('You have no score for this beatmap. Play it first!'),
                ephemeral: true 
              });
            }
          }
        } else {
          // No link provided - use most recent score only
          const recentScoresData = await getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
          const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];
          
          if (!recentScores || recentScores.length === 0) {
            return interaction.editReply({ 
              embeds: await createEmbed('You have no recent scores. Play a map first!'),
              ephemeral: true 
            });
          }
          
          responderScore = recentScores[0];
          
          // Check if the recent score is for the correct beatmap
          if (responderScore.beatmap?.id?.toString() !== existingChallenge.beatmapId) {
            return interaction.editReply({ 
              embeds: await createEmbed('Your most recent score is not for this beatmap. Use `/rsc` with the map link to respond to this challenge.'),
              ephemeral: true 
            });
          }
        }
      }

      const challengerScore = existingChallenge.challengerScore;
      const challengeDifficulty = existingChallenge.difficulty;

      // Ensure challengerScore is an object (Prisma JSON field)
      if (typeof challengerScore !== 'object' || challengerScore === null) {
        return interaction.editReply({ 
          embeds: await createEmbed('Error: Challenge data is invalid. Please create a new challenge.'),
          ephemeral: true 
        });
      }

      // Get map title and format difficulty label with link
      const mapTitle = await getMapTitle(challengerScore);
      const artist = await getMapArtist(challengerScore);
      const difficultyLabel = formatDifficultyLabel(mapTitle, challengeDifficulty, artist);
      const starRatingText = await formatStarRating(challengerScore);
      const beatmapLink = formatBeatmapLink(challengerScore);
      const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

      // Compare scores and create comparison table
      let comparisonResult;
      try {
        comparisonResult = compareScores(challengerScore, responderScore, interaction.user.username);
      } catch (error) {
        console.error('Error comparing scores:', error);
        return interaction.editReply({ 
          embeds: await createEmbed(`Error comparing scores: ${error.message}`),
          ephemeral: true 
        });
      }

      const { responderWins, challengerWins, totalMetrics, statWinners } = comparisonResult;

      // Check if responder wins (3+ out of 5 metrics) — must know before generating card
      const responderWon = responderWins >= 3;
      const isOwnChallenge = existingChallenge.challengerUserId === userId;

      // Update challenge: new champion when someone else wins, or new score when holder improves own challenge
      if (responderWon) {
        try {
          await activeChallenges.updateChampion(
            guildId,
            existingChallenge.beatmapId,
            challengeDifficulty,
            userId,
            osuUserId,
            responderScore
          );
        } catch (error) {
          console.error('Error updating challenge champion:', error);
        }
      }
      // When holder responds to own challenge and fails to improve, we keep the previous score (no update)

      // Fetch champion and responder osu users for card (avatar + username)
      const championOsuId = existingChallenge.challengerOsuId;
      let leftUser = { avatarBuffer: null, username: challengerScore.user?.username || 'Champion' };
      let rightUser = { avatarBuffer: null, username: interaction.user.username };
      try {
        const championUser = await getUser(championOsuId);
        if (championUser) {
          leftUser.username = (championUser.username && String(championUser.username).trim()) || leftUser.username;
          if (championUser.avatar_url) {
            const res = await fetch(championUser.avatar_url);
            if (res.ok) leftUser.avatarBuffer = Buffer.from(await res.arrayBuffer());
          }
        }
        const responderUser = await getUser(osuUserId);
        if (responderUser) {
          rightUser.username = (responderUser.username && String(responderUser.username).trim()) || interaction.user.username;
          if (responderUser.avatar_url) {
            const res = await fetch(responderUser.avatar_url);
            if (res.ok) rightUser.avatarBuffer = Buffer.from(await res.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn('[rsc] Failed to fetch osu users for card:', e.message);
      }

      const loserSide = responderWon ? 'left' : 'right';
      const cardBuffer = await drawChallengeCard(leftUser, rightUser, challengerScore, responderScore, statWinners, loserSide);
      const cardAttachment = new AttachmentBuilder(cardBuffer, { name: 'challenge-card.png' });

      const statsLine = `(${responderWins}/5 key stats)`;
      const displayName = interaction.user.username;
      let statusMessage = '';
      if (isOwnChallenge) {
        if (responderWon) {
          statusMessage = `\n\n🏆 **${displayName} has improved the score! The stakes are higher now!** ${statsLine} 🏆`;
        } else {
          statusMessage = `\n\n😅 **${displayName} has failed to improve the score. Let's pretend Teto didn't see that...**`;
        }
      } else {
        if (responderWon) {
          statusMessage = `\n\n🏆 **${displayName} has won the challenge and is now the new champion!** ${statsLine} 🏆`;
        } else {
          statusMessage = `\n\n❌ **${displayName} did not win the challenge.** ${statsLine} The current champion remains.`;
        }
      }

      const messageBeforeImage = `<@${userId}> has responded to the challenge on ${difficultyLink}!\nLet's see who is better!`;
      const messageAfterImage = `\n\n${statusMessage}`;

      const embed1 = new EmbedBuilder()
        .setColor(BOT_EMBED_COLOR)
        .setDescription(messageBeforeImage)
        .setImage('attachment://challenge-card.png');
      const embed2 = new EmbedBuilder()
        .setColor(BOT_EMBED_COLOR)
        .setDescription(messageAfterImage);
      await opChannel.send({ embeds: [embed1, embed2], files: [cardAttachment] });

      // Send confirmation to user
      return interaction.editReply({ 
        embeds: await createEmbed(`Challenge response posted to <#${opChannel.id}>!`),
        ephemeral: true 
      });

    } catch (error) {
      console.error('Error in /rsc command:', error);
      return interaction.editReply({ 
        embeds: await createEmbed(`Error: ${error.message}`),
        ephemeral: true 
      });
    }
  }

  // Handle /trs command
  if (interaction.commandName === 'trs') {
    await interaction.deferReply({ ephemeral: false });

    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        return interaction.editReply({ 
          embeds: await createEmbed('This command can only be used in a server.'),
          ephemeral: true 
        });
      }
      const userId = interaction.user.id;

      // Check if user has association
      const association = await associations.get(guildId, userId);
      if (!association || !association.osuUserId) {
        return interaction.editReply({ 
          embeds: await createEmbed('You need to link your Discord profile to your OSU! profile first. Use `/teto link` command to do so.'),
          ephemeral: true 
        });
      }

      const osuUserId = association.osuUserId;

      // Get most recent score (including failed scores)
      const recentScoresData = await getUserRecentScores(osuUserId, { limit: 1, include_fails: true });
      const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];
      
      if (!recentScores || recentScores.length === 0) {
        return interaction.editReply({ 
          embeds: await createEmbed('You have no recent scores. Play a map first!'),
          ephemeral: true 
        });
      }

      const userScore = recentScores[0];
      
      // Validate score object
      if (!isValidScore(userScore)) {
        return interaction.editReply({ 
          embeds: await createEmbed('Invalid score data received from OSU API. Please play a map first and try again.'),
          ephemeral: true 
        });
      }

      // Get beatmap info to check status
      const beatmapId = userScore.beatmap.id.toString();
      let beatmapStatus = null;
      let beatmapStatusName = 'Unknown';
      
      // Try to get status from score object first (might be in beatmap or beatmapset)
      if (userScore.beatmap?.status !== undefined) {
        beatmapStatus = userScore.beatmap.status;
        beatmapStatusName = getBeatmapStatusName(beatmapStatus);
      } else if (userScore.beatmap?.beatmapset?.status !== undefined) {
        beatmapStatus = userScore.beatmap.beatmapset.status;
        beatmapStatusName = getBeatmapStatusName(beatmapStatus);
      } else {
        // Fallback: fetch beatmap to get status
        try {
          const beatmap = await getBeatmap(beatmapId);
          // Status might be in beatmap.status or beatmap.beatmapset.status
          beatmapStatus = beatmap?.status ?? beatmap?.beatmapset?.status;
          beatmapStatusName = getBeatmapStatusName(beatmapStatus);
        } catch (error) {
          // Continue with unknown status
        }
      }

      // Format score display (same as challenge posting)
      const beatmapLink = formatBeatmapLink(userScore);
      const playerStats = await formatPlayerStats(userScore);
      const mapTitle = await getMapTitle(userScore);
      const artist = await getMapArtist(userScore);
      const difficulty = userScore.beatmap.version;
      const difficultyLabel = formatDifficultyLabel(mapTitle, difficulty, artist);
      const starRatingText = await formatStarRating(userScore);
      const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

      // Check if score rank is F - if so, always save to local DB regardless of map type
      const scoreRank = userScore.rank || 'N/A';
      const isRankF = scoreRank === 'F' || scoreRank === 'f';
      
      // Check if score is saved on osu! servers
      const isSaved = isScoreSavedOnOsu(beatmapStatus);
      let statusMessage = '';

      if (isSaved && !isRankF) {
        // Score is saved on osu! servers and not F rank - don't save locally
        statusMessage = `\nThis map is **${beatmapStatusName}**. The score is saved on the OSU! servers.`;
      } else {
        // Save to local database (if F rank, always save; otherwise only if not saved on osu!)
        try {
          const existing = await localScores.exists(guildId, userId, userScore);
          if (existing) {
            statusMessage = `\nThe map is **${beatmapStatusName}**. This score is already saved.`;
          } else {
            await localScores.create(guildId, userId, osuUserId, userScore);
            statusMessage = `\nThe map is **${beatmapStatusName}**. ${await formatTetoText('Teto will remember this score.')}`;
          }
        } catch (error) {
          console.error('Error saving local score:', error);
          statusMessage = `\nThe map is **${beatmapStatusName}**. Failed to save score locally.`;
        }
      }

      // Build message with only the most recent score
      let message = `Your most recent score on ${difficultyLink}:\n\n${playerStats}${statusMessage}`;

      // Get beatmapset image URL for the embed
      const imageUrl = await getBeatmapsetImageUrl(userScore);

      return interaction.editReply({ 
        embeds: await createEmbed(message, imageUrl)
      });

    } catch (error) {
      console.error('Error in /trs command:', error);
      return interaction.editReply({ 
        embeds: await createEmbed(`Error: ${error.message}`),
        ephemeral: true 
      });
    }
  }

  // Handle /tc command
  if (interaction.commandName === 'tc') {
    await interaction.deferReply({ ephemeral: false });

    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        return interaction.editReply({ 
          embeds: await createEmbed('This command can only be used in a server.'),
          ephemeral: true 
        });
      }
      const userId = interaction.user.id;
      const channel = interaction.channel;

      // Check if user has association
      const association = await associations.get(guildId, userId);
      if (!association || !association.osuUserId) {
        return interaction.editReply({ 
          embeds: await createEmbed('You need to link your Discord profile to your OSU! profile first. Use `/teto link` command to do so.'),
          ephemeral: true 
        });
      }

      const osuUserId = association.osuUserId;

      // Fetch last 20 messages from the channel
      const messages = await channel.messages.fetch({ limit: 20 });
      
      // Search for difficulty link in messages (check content and all embed fields)
      let beatmapInfo = null;
      for (const [messageId, message] of messages) {
        // Get text from message content
        let messageText = message.content || '';
        
        // Extract all text from all embeds (description, title, fields, footer, author, URL)
        if (message.embeds && message.embeds.length > 0) {
          for (const embed of message.embeds) {
            // Add description
            if (embed.description) {
              messageText += ' ' + embed.description;
            }
            // Add title
            if (embed.title) {
              messageText += ' ' + embed.title;
            }
            // Add footer text
            if (embed.footer?.text) {
              messageText += ' ' + embed.footer.text;
            }
            // Add author name
            if (embed.author?.name) {
              messageText += ' ' + embed.author.name;
            }
            // Add embed URL (if the embed itself is a link)
            if (embed.url) {
              messageText += ' ' + embed.url;
            }
            // Add all field names and values
            if (embed.fields && Array.isArray(embed.fields)) {
              for (const field of embed.fields) {
                if (field.name) {
                  messageText += ' ' + field.name;
                }
                if (field.value) {
                  messageText += ' ' + field.value;
                }
              }
            }
          }
        }
        
        messageText = messageText.trim();
        
        beatmapInfo = extractBeatmapInfoFromMessage(messageText);
        if (beatmapInfo) {
          break;
        }
      }

      if (!beatmapInfo) {
        return interaction.editReply({ 
          embeds: await createEmbed('No difficulty link found in the last 20 messages of this channel.'),
          ephemeral: true 
        });
      }

      let { beatmapId, difficulty } = beatmapInfo;
      let finalDifficulty = difficulty; // Will be updated if needed
      let beatmapData = null; // Declare outside try block so it's accessible for local scores section

      // Step 1: Check for API scores first
      // Use /beatmaps/{beatmap}/scores/users/{user}/all endpoint to get all user's scores for this beatmap
      try {
        // Get all user's scores for this beatmap
        const allBeatmapScores = await getUserBeatmapScoresAll(beatmapId, osuUserId);
        
        // The API response from /beatmaps/{beatmap}/scores/users/{user}/all doesn't include beatmap.version
        // We need to fetch the beatmap to get the difficulty name, or all scores are for the same beatmap
        // Since all scores are for the same beatmap ID, we can fetch the beatmap once to get the difficulty
        let beatmapDifficulty = null;
        try {
          beatmapData = await getBeatmap(beatmapId);
          beatmapDifficulty = beatmapData.version;
          // Always use difficulty from API as it's the source of truth
          // This ensures consistency even if extracted difficulty from message doesn't match exactly
          if (beatmapDifficulty) {
            finalDifficulty = beatmapDifficulty;
          }
        } catch (error) {
          // Continue without difficulty match
        }
        
        // All scores from getUserBeatmapScoresAll are already for the same beatmap ID (difficulty ID)
        // So we should use ALL of them - no need to filter by difficulty name
        // The difficulty name matching was causing issues when extracted difficulty didn't match exactly
        const matchingScores = allBeatmapScores;

        if (matchingScores.length > 0) {
          // Sort by score value (highest first) and limit to 8
          const sortedScores = matchingScores
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 8);

          // Get map info - prefer beatmapData we already fetched, otherwise use first score
          let mapTitle = null;
          let beatmapLink = null;
          
          if (beatmapData) {
            // Use the beatmap data we already fetched
            mapTitle = beatmapData.beatmapset?.title || beatmapData.beatmapset?.title_unicode || 'Unknown Map';
            const beatmapsetId = beatmapData.beatmapset_id || beatmapData.beatmapset?.id;
            if (beatmapsetId && beatmapId) {
              beatmapLink = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
            } else if (beatmapId) {
              beatmapLink = `https://osu.ppy.sh/beatmaps/${beatmapId}`;
            }
          } else {
            // Fallback to first score
            const firstScore = sortedScores[0];
            beatmapLink = formatBeatmapLink(firstScore);
            mapTitle = await getMapTitle(firstScore);
          }
          
          // Use beatmapData if available, otherwise use first score for star rating
          const scoreOrBeatmapForStarRating = beatmapData || sortedScores[0];
          const artist = beatmapData?.beatmapset?.artist || beatmapData?.beatmapset?.artist_unicode || await getMapArtist(sortedScores[0]) || '';
          // Always use difficulty name from API (beatmapDifficulty) as it's the source of truth
          // Fall back to difficulty from score if we don't have beatmapData
          const displayDifficulty = beatmapDifficulty || sortedScores[0]?.beatmap?.version || difficulty || 'Unknown';
          const difficultyLabel = formatDifficultyLabel(mapTitle, displayDifficulty, artist);
          const starRatingText = await formatStarRating(scoreOrBeatmapForStarRating);
          const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

          // Build message with all scores
          let message = `Your scores on ${difficultyLink}:\n\n`;
          
          for (let i = 0; i < sortedScores.length; i++) {
            const score = sortedScores[i];
            
            if (i === 0) {
              // First score: full format
              // Enhance score object with beatmapData to ensure map stats are available
              let enhancedScore = score;
              if (beatmapData) {
                // Extract map stats from beatmapData (osu! API v2 uses these property names)
                const csValue = beatmapData.cs ?? beatmapData.circle_size ?? null;
                const arValue = beatmapData.ar ?? beatmapData.approach_rate ?? null;
                const bpmValue = beatmapData.bpm ?? null;
                const odValue = beatmapData.accuracy ?? beatmapData.overall_difficulty ?? null;
                const hpValue = beatmapData.drain ?? beatmapData.hp ?? beatmapData.health ?? null;
                
                // Also check score.beatmap if it exists
                const finalCs = csValue ?? score.beatmap?.cs ?? score.beatmap?.circle_size ?? null;
                const finalAr = arValue ?? score.beatmap?.ar ?? score.beatmap?.approach_rate ?? null;
                const finalBpm = bpmValue ?? score.beatmap?.bpm ?? null;
                const finalOd = odValue ?? score.beatmap?.accuracy ?? score.beatmap?.overall_difficulty ?? null;
                const finalHp = hpValue ?? score.beatmap?.drain ?? score.beatmap?.hp ?? score.beatmap?.health ?? null;
                
                // Create or enhance beatmap object
                enhancedScore = {
                  ...score,
                  beatmap: {
                    ...(score.beatmap || {}),
                    id: score.beatmap?.id ?? beatmapData.id ?? beatmapId,
                    cs: finalCs,
                    ar: finalAr,
                    bpm: finalBpm,
                    accuracy: finalOd,
                    overall_difficulty: finalOd,
                    drain: finalHp,
                    hp: finalHp,
                    health: finalHp,
                    circle_size: finalCs,
                    approach_rate: finalAr,
                  }
                };
              }
              const playerStats = await formatPlayerStats(enhancedScore);
              message += `**Score #${i + 1}**\n${playerStats}`;
            } else {
              // Subsequent scores: compact one-line format
              const compactStats = await formatPlayerStatsCompact(score);
              message += `**Score #${i + 1}**: ${compactStats}\n`;
            }
          }

          // Get beatmapset image URL for the embed
          const imageUrl = await getBeatmapsetImageUrl(beatmapData || sortedScores[0]);

          return interaction.editReply({ 
            embeds: await createEmbed(message, imageUrl)
          });
        }
      } catch (error) {
        console.error('Error fetching scores from osu! API:', error);
        // Continue to check local scores
      }

      // Step 2: If not found in API, check local scores
      // Always fetch beatmap to get the correct difficulty name (source of truth)
      // Don't rely on extracted difficulty from message as it might not match exactly
      if (!beatmapData) {
        try {
          beatmapData = await getBeatmap(beatmapId);
          finalDifficulty = beatmapData.version;
        } catch (error) {
          // Continue without difficulty - will use extracted one as fallback
        }
      } else {
        // We already have beatmapData from API scores section, use its difficulty
        finalDifficulty = beatmapData.version;
      }
      const localScoreRecords = await localScores.getByBeatmapAndDifficulty(guildId, userId, beatmapId, finalDifficulty);
      
      if (localScoreRecords && localScoreRecords.length > 0) {
        // Sort by creation date (most recent first) and limit to 8
        const sortedRecords = localScoreRecords
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 8);

        // Get map info from first score, but also try to fetch beatmap if needed
        const firstScore = sortedRecords[0].score;
        let beatmapLink = formatBeatmapLink(firstScore);
        let mapTitle = await getMapTitle(firstScore);
        let beatmapData = null;
        
        // If we don't have a proper link or title, try fetching the beatmap
        if (!beatmapLink || mapTitle === 'Unknown Map') {
          try {
            beatmapData = await getBeatmap(beatmapId);
            if (!mapTitle || mapTitle === 'Unknown Map') {
              mapTitle = beatmapData.beatmapset?.title || beatmapData.beatmapset?.title_unicode || 'Unknown Map';
            }
            if (!beatmapLink) {
              const beatmapsetId = beatmapData.beatmapset_id || beatmapData.beatmapset?.id;
              if (beatmapsetId && beatmapId) {
                beatmapLink = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
              } else if (beatmapId) {
                beatmapLink = `https://osu.ppy.sh/beatmaps/${beatmapId}`;
              }
            }
          } catch (error) {
            // Fallback: use beatmapId to construct basic link if we still don't have one
            if (!beatmapLink && beatmapId) {
              beatmapLink = `https://osu.ppy.sh/beatmaps/${beatmapId}`;
            }
          }
        }
        
        // Use beatmapData if available, otherwise use first score for star rating
        // If we don't have beatmapData yet, try to fetch it to get difficulty
        if (!beatmapData && finalDifficulty) {
          try {
            beatmapData = await getBeatmap(beatmapId);
          } catch (error) {
            // Continue without beatmapData
          }
        }
        const scoreOrBeatmapForStarRating = beatmapData || sortedRecords[0].score;
        const artist = beatmapData?.beatmapset?.artist || beatmapData?.beatmapset?.artist_unicode || await getMapArtist(sortedRecords[0].score) || '';
        const difficultyLabel = formatDifficultyLabel(mapTitle, finalDifficulty || sortedRecords[0].score.beatmap?.version || 'Unknown', artist);
        const starRatingText = await formatStarRating(scoreOrBeatmapForStarRating);
        const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

        // Build message with all local scores
        const storageText = await formatTetoText('(from Teto memories):');
        let message = `Your scores on ${difficultyLink} ${storageText}\n\n`;
        
        for (let i = 0; i < sortedRecords.length; i++) {
          const record = sortedRecords[i];
          
          if (i === 0) {
            // First score: full format
            // Enhance score object with beatmapData to ensure map stats are available
            let enhancedScore = record.score;
            if (beatmapData && record.score.beatmap) {
              // Extract map stats from beatmapData (osu! API v2 uses these property names)
              const csValue = beatmapData.cs ?? beatmapData.circle_size ?? record.score.beatmap.cs ?? record.score.beatmap.circle_size ?? null;
              const arValue = beatmapData.ar ?? beatmapData.approach_rate ?? record.score.beatmap.ar ?? record.score.beatmap.approach_rate ?? null;
              const bpmValue = beatmapData.bpm ?? record.score.beatmap.bpm ?? null;
              const odValue = beatmapData.accuracy ?? beatmapData.overall_difficulty ?? record.score.beatmap.accuracy ?? record.score.beatmap.overall_difficulty ?? null;
              const hpValue = beatmapData.drain ?? beatmapData.hp ?? beatmapData.health ?? record.score.beatmap.drain ?? record.score.beatmap.hp ?? record.score.beatmap.health ?? null;
              
              enhancedScore = {
                ...record.score,
                beatmap: {
                  ...record.score.beatmap,
                  cs: csValue,
                  ar: arValue,
                  bpm: bpmValue,
                  accuracy: odValue,
                  overall_difficulty: odValue,
                  drain: hpValue,
                  hp: hpValue,
                  health: hpValue,
                  circle_size: csValue,
                  approach_rate: arValue,
                }
              };
            }
            const playerStats = await formatPlayerStats(enhancedScore);
            message += `**Score #${i + 1}**\n${playerStats}`;
          } else {
            // Subsequent scores: compact one-line format
            const compactStats = await formatPlayerStatsCompact(record.score);
            message += `**Score #${i + 1}**: ${compactStats}\n`;
          }
        }

        // Get beatmapset image URL for the embed
        const imageUrl = await getBeatmapsetImageUrl(beatmapData || firstScore);

        return interaction.editReply({ 
          embeds: await createEmbed(message, imageUrl)
        });
      }

      // Step 3: No score found in either place
      // Fetch beatmap data to format the error message with map name and difficulty as a link
      let mapTitle = null;
      let difficultyName = null;
      let beatmapLink = null;
      let beatmapDataForError = null;
      
      try {
        beatmapDataForError = await getBeatmap(beatmapId);
        mapTitle = beatmapDataForError.beatmapset?.title || beatmapDataForError.beatmapset?.title_unicode || 'Unknown Map';
        // Always use the difficulty name from the beatmap API (beatmapData.version) as it's the source of truth
        // Don't use the extracted difficulty from the message as it might be incorrect (e.g., star rating)
        difficultyName = beatmapDataForError.version;
        
        // Construct beatmap link
        const beatmapsetId = beatmapDataForError.beatmapset_id || beatmapDataForError.beatmapset?.id;
        if (beatmapsetId && beatmapId) {
          beatmapLink = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
        } else if (beatmapId) {
          beatmapLink = `https://osu.ppy.sh/beatmaps/${beatmapId}`;
        }
      } catch (error) {
        // Fallback if we can't fetch beatmap data
        console.error('Error fetching beatmap data for error message:', error);
      }
      
      // Format the difficulty label as a clickable link
      const artistForError = beatmapDataForError?.beatmapset?.artist || beatmapDataForError?.beatmapset?.artist_unicode || '';
      let difficultyLabel = null;
      if (mapTitle && difficultyName && beatmapLink) {
        const difficultyLabelText = formatDifficultyLabel(mapTitle, difficultyName, artistForError);
        const starRatingText = beatmapDataForError ? await formatStarRating(beatmapDataForError) : '';
        difficultyLabel = `${starRatingText}[${difficultyLabelText}](${beatmapLink})`;
      } else if (difficultyName && beatmapLink) {
        const difficultyLabelText = formatDifficultyLabel('Unknown Map', difficultyName, artistForError);
        const starRatingText = beatmapDataForError ? await formatStarRating(beatmapDataForError) : '';
        difficultyLabel = `${starRatingText}[${difficultyLabelText}](${beatmapLink})`;
      } else if (difficultyName) {
        difficultyLabel = `difficulty **${difficultyName}**`;
      } else {
        difficultyLabel = 'this difficulty';
      }
      
      return interaction.editReply({ 
        embeds: await createEmbed(`No score found for ${difficultyLabel}. Play it first!`),
        ephemeral: true 
      });

    } catch (error) {
      console.error('Error in /tc command:', error);
      return interaction.editReply({ 
        embeds: await createEmbed(`Error: ${error.message}`),
        ephemeral: true 
      });
    }
  }

  // Handle /teto commands
  if (interaction.commandName !== 'teto') return;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  const guildId = interaction.guildId;
  if (!guildId) {
    return interaction.reply({ 
      embeds: await createEmbed('This command can only be used in a server.'),
      ephemeral: true 
    });
  }
  const channel = interaction.channel;

  // /teto setup
  if (sub === 'setup') {
    // only admins (including server owner)
    const member = interaction.member;
    if (!member) {
      return interaction.reply({ embeds: await createEmbed('Unable to verify permissions. Please try again.'), ephemeral: true });
    }
    
    // Check if user is guild owner
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    
    // Check if user has Administrator permission
    const memberPerms = member.permissions;
    const hasAdmin = memberPerms && memberPerms.has(PermissionsBitField.Flags.Administrator);
    
    if (!isOwner && !hasAdmin) {
      return interaction.reply({ embeds: await createEmbed('Only administrators can run this command.'), ephemeral: true });
    }
    
    const channelType = interaction.options.getString('set_this_channel_for');
    if (!channelType || (channelType !== 'tmotd' && channelType !== 'challenges')) {
      return interaction.reply({ 
        embeds: await createEmbed('Invalid channel type. Please select either "TMOTD" or "Challenges".'), 
        ephemeral: true 
      });
    }
    
    await dbServerConfig.setChannel(guildId, channelType, channel.id);
    
    const channelTypeName = channelType === 'tmotd' ? 'TMOTD' : 'Challenges';
    const message = await formatTetoText(`Teto configured! ${channelTypeName} channel set to <#${channel.id}>.`);
    return interaction.reply({ 
      embeds: await createEmbed(message), 
      ephemeral: true 
    });
  }

  // /teto link
  if (sub === 'link') {
    const profileLink = interaction.options.getString('profilelink');
    
    // Validate link format - must contain "osu.ppy.sh/users/"
    if (!profileLink || !profileLink.includes('osu.ppy.sh/users/')) {
      return interaction.reply({ 
        embeds: await createEmbed('Invalid OSU! profile link. The link must contain "osu.ppy.sh/users/" in it.\nExample: https://osu.ppy.sh/users/12345 or https://osu.ppy.sh/users/username'), 
        ephemeral: true 
      });
    }

    const profileInfo = extractOsuProfile(profileLink);

    if (!profileInfo) {
      return interaction.reply({ 
        embeds: await createEmbed('Invalid OSU! profile link format. Please provide a valid link like:\n- https://osu.ppy.sh/users/12345\n- https://osu.ppy.sh/users/username'), 
        ephemeral: true 
      });
    }

    // Check if Discord user already has a profile linked
    const existingAssociation = await associations.get(guildId, interaction.user.id);
    if (existingAssociation) {
      const existingDisplayName = existingAssociation.osuUsername || `User ${existingAssociation.osuUserId}`;
      return interaction.reply({ 
        embeds: await createEmbed(`You already have an OSU! profile linked: **${existingDisplayName}**\nProfile: ${existingAssociation.profileLink}\n\nTo link a different profile, please contact an administrator.`), 
        ephemeral: true 
      });
    }

    // Check if OSU profile is already linked to another Discord user
    let existingOsuLink = null;
    if (profileInfo.userId) {
      existingOsuLink = await associations.findByOsuUserIdInGuild(guildId, profileInfo.userId);
    } else if (profileInfo.username) {
      existingOsuLink = await associations.findByOsuUsernameInGuild(guildId, profileInfo.username);
    }

    if (existingOsuLink && existingOsuLink.discordUserId !== interaction.user.id) {
      return interaction.reply({ 
        embeds: await createEmbed(`This OSU! profile is already linked to another Discord user (<@${existingOsuLink.discordUserId}>).\nEach OSU! profile can only be linked to one Discord account per server.`), 
        ephemeral: true 
      });
    }

    // Verify that the OSU profile exists
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const userIdentifier = profileInfo.userId || profileInfo.username;
      const osuUser = await getUser(userIdentifier);
      
      if (!osuUser) {
        return interaction.editReply({ 
          embeds: await createEmbed(`The OSU! profile you provided does not exist.\nPlease check the link and try again.`)
        });
      }

      // Update profile info with verified data from API
      const verifiedUserId = osuUser.id?.toString();
      const verifiedUsername = osuUser.username;
      const verifiedProfileLink = `https://osu.ppy.sh/users/${verifiedUserId}`;

      await associations.set(guildId, interaction.user.id, {
        discordUsername: interaction.user.username,
        osuUsername: verifiedUsername,
        osuUserId: verifiedUserId,
        profileLink: verifiedProfileLink,
      });

      return interaction.editReply({ 
        embeds: await createEmbed(`✅ Successfully linked your Discord account to OSU! profile: **${verifiedUsername}**\nProfile: ${verifiedProfileLink}`)
      });
    } catch (error) {
      console.error('Error verifying OSU profile:', error);
      return interaction.editReply({ 
        embeds: await createEmbed(`Error verifying OSU! profile: ${error.message}\nPlease try again later.`)
      });
    }
  }

  // /teto help
  if (sub === 'help') {
    const helpMessage = `**Teto Bot Commands**

**Map of the Day:**
• \`/teto map submit\` - Submit your map of the day with optional recommended mods

**Challenges:**
• \`/rsc\` - Issue or respond to a score challenge
  Without link: Uses your most recent score to issue/respond to a challenge
  With link: Fetches your top score for the beatmap (falls back to most recent if needed) to issue/respond
  If no challenge exists for the difficulty, a new challenge will be created

**Score Tracking:**
• \`/trs\` - Record your most recent unranked/WIP score
• \`/tc\` - Look up your scores for a map (searches last 20 messages for difficulty link)

**Setup & Configuration:**
• \`/teto setup\` - Configure bot channels (admin only). Set current channel for TMOTD or Challenges
• \`/teto link\` - Link your Discord account to your OSU! profile
• \`/teto test\` - Test command UI (admin only)
• \`/teto help\` - Show this help message

**Note:** Most commands require linking your OSU! profile first using \`/teto link\``;

    return interaction.reply({ 
      embeds: await createEmbed(helpMessage),
      ephemeral: true 
    });
  }

  // /teto test
  if (sub === 'test') {
    // only admins (including server owner)
    const member = interaction.member;
    if (!member) {
      return interaction.reply({ embeds: await createEmbed('Unable to verify permissions. Please try again.'), ephemeral: true });
    }
    
    // Check if user is guild owner
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    
    // Check if user has Administrator permission
    const memberPerms = member.permissions;
    const hasAdmin = memberPerms && memberPerms.has(PermissionsBitField.Flags.Administrator);
    
    if (!isOwner && !hasAdmin) {
      return interaction.reply({ embeds: await createEmbed('Only administrators can run this command.'), ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    try {
      const testCommand = interaction.options.getString('command');
      if (!testCommand) {
        return interaction.editReply({ 
          embeds: await createEmbed('Invalid test command. Available: trs, tc, rsci, rscr, motd, report, card'),
          ephemeral: true 
        });
      }

      switch (testCommand) {
        case 'trs':
          await testTrsCommand(interaction, guildId);
          break;
        case 'tc':
          await testTcCommand(interaction, guildId);
          break;
        case 'rsci':
          await testRscIssueCommand(interaction, guildId);
          break;
        case 'rscr':
          await testRscRespondCommand(interaction, guildId);
          break;
        case 'motd':
          await testMotdCommand(interaction, guildId);
          break;
        case 'report':
          await testReportCommand(interaction, guildId);
          break;
        case 'card':
          await testCardCommand(interaction, guildId);
          break;
        default:
          return interaction.editReply({ 
            embeds: await createEmbed('Invalid test command. Available: trs, tc, rsci, rscr, motd, report, card'),
            ephemeral: true 
          });
      }
    } catch (error) {
      console.error('Error in /teto test command:', error);
      return interaction.editReply({ 
        embeds: await createEmbed(`Error: ${error.message}`),
        ephemeral: true 
      });
    }
    return;
  }


  // /teto map submit
  if (subcommandGroup === 'map' && sub === 'submit') {
    const mapLink = interaction.options.getString('maplink');
    if (!mapLink || !mapLink.includes('osu.ppy.sh')) {
      return interaction.reply({ embeds: await createEmbed("Impossible to submit the map - link doesn't contain OSU! map"), ephemeral: true });
    }
    const today = todayString();
    const hasSubmitted = await submissions.hasSubmittedToday(guildId, interaction.user.id, today);
    if (hasSubmitted) {
      return interaction.reply({ embeds: await createEmbed('You already submitted a map today!'), ephemeral: true });
    }

    // collect mods
    const mods = [];
    for (let i = 1; i <= 5; i++) {
      const mod = interaction.options.getString(`recommended_mod_${i}`);
      if (mod) mods.push(mod);
    }

    // fetch op channel for TMOTD
    const opChannelResult = await getOperatingChannel(guildId, interaction.guild, 'tmotd');
    if (opChannelResult.error) {
      return interaction.reply({ embeds: await createEmbed(opChannelResult.error), ephemeral: true });
    }
    const opChannel = opChannelResult.channel;
    const opChannelId = opChannelResult.channelId;

    // Get beatmap data to format message with map name and difficulty
    let mapName = null;
    let difficultyName = null;
    let difficultyLink = mapLink; // Fallback to original link if we can't get beatmap data
    let imageUrl = null;
    let beatmap = null;
    
    try {
      const beatmapId = extractBeatmapId(mapLink);
      if (beatmapId) {
        beatmap = await getBeatmap(beatmapId);
        mapName = beatmap?.beatmapset?.title || beatmap?.beatmapset?.title_unicode || null;
        difficultyName = beatmap?.version || null;
        imageUrl = await getBeatmapsetImageUrl(beatmap);
        
        // Construct difficulty link
        const beatmapsetId = beatmap?.beatmapset_id || beatmap?.beatmapset?.id;
        if (beatmapsetId && beatmapId) {
          difficultyLink = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
        } else if (beatmapId) {
          difficultyLink = `https://osu.ppy.sh/beatmaps/${beatmapId}`;
        }
      }
    } catch (error) {
      console.error('Error getting beatmap data for map of the day:', error);
      // Continue with fallback link if there's an error
    }

    // Format message with map name and difficulty as link (with star rating)
    const artist = beatmap?.beatmapset?.artist || beatmap?.beatmapset?.artist_unicode || '';
    let difficultyLabel = null;
    const starRatingText = await formatStarRating(beatmap);
    if (mapName && difficultyName) {
      const label = formatDifficultyLabel(mapName, difficultyName, artist);
      difficultyLabel = `${starRatingText}[${label}](${difficultyLink})`;
    } else if (difficultyName) {
      const label = formatDifficultyLabel('Unknown Map', difficultyName, artist);
      difficultyLabel = `${starRatingText}[${label}](${difficultyLink})`;
    } else {
      difficultyLabel = starRatingText + difficultyLink; // Fallback to plain link with star rating
    }

    let msgContent = `<@${interaction.user.id}> map of the day is - ${difficultyLabel}`;
    if (mods.length > 0) {
      msgContent += `\nRecommended mods: ${mods.join(', ')}`;
    }

    try {
      const sent = await opChannel.send({ embeds: await createEmbed(msgContent, imageUrl) });
      // bot adds its own reactions (non-critical if this fails)
      try {
        await sent.react('👍');
        await sent.react('👎');
      } catch (reactErr) {
        console.warn('Failed to add reactions to submission (non-critical):', reactErr);
      }
      // store submission
      await submissions.create(guildId, interaction.user.id, today);
      return interaction.reply({ embeds: await createEmbed(`Map submitted to <#${opChannelId}>!`), ephemeral: true });
    } catch (err) {
      console.error('Failed to post submission:', err);
      return interaction.reply({ embeds: await createEmbed('Failed to submit the map. Check bot permissions in the operating channel.'), ephemeral: true });
    }
  }

});

// Reaction handling - monitor 👎 count
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (user.bot) return; // ignore bot reactions for triggering logic, we still count bots in users.fetch()
    const msg = reaction.message;
    if (!msg || !msg.guildId) return;
    if (reaction.emoji.name !== '👎') return;

    // Only monitor reactions in operating channels (check both TMOTD and Challenges channels)
    const config = await dbServerConfig.get(msg.guildId);
    if (!config) return;
    
    const tmotdChannelId = config.tmotdChannelId;
    const challengesChannelId = config.challengesChannelId;
    
    // Check if message is in either operating channel
    if (msg.channelId !== tmotdChannelId && msg.channelId !== challengesChannelId) return;

    // Skip if message was already edited (contains "voted to be meh")
    if (msg.content.includes('voted to be meh')) return;

    // count users who reacted with 👎 (includes bot if it reacted)
    const users = await reaction.users.fetch();
    const count = users.size;
    if (count >= 4) {
      // Extract original submitter id from message - check both content and embed description
      let uid = null;
      
      // Get text from message content or embed description
      let messageText = msg.content || '';
      if (msg.embeds && msg.embeds.length > 0 && msg.embeds[0].description) {
        messageText = (messageText + ' ' + msg.embeds[0].description).trim();
      }
      
      // Try to extract user ID from the beginning of the message text
      const matcher = messageText.match(/^<@!?(\d+)>/);
      if (matcher) {
        uid = matcher[1];
      }
      
      // Extract beatmap data from the original message to get map name and difficulty
      let mapName = null;
      let difficultyName = null;
      let difficultyLink = null;
      let beatmap = null;
      
      try {
        
        // Extract osu.ppy.sh link from message text (could be markdown link or plain link)
        let mapLink = null;
        
        // Try to extract markdown link first: [text](url)
        const markdownLinkMatch = messageText.match(/\[([^\]]+)\]\((https?:\/\/osu\.ppy\.sh\/[^\)]+)\)/);
        if (markdownLinkMatch) {
          mapLink = markdownLinkMatch[2];
        } else {
          // Try plain link
          const plainLinkMatch = messageText.match(/https?:\/\/osu\.ppy\.sh\/[^\s\)]+/);
          if (plainLinkMatch) {
            mapLink = plainLinkMatch[0];
          }
        }
        
        if (mapLink) {
          const beatmapId = extractBeatmapId(mapLink);
          if (beatmapId) {
            beatmap = await getBeatmap(beatmapId);
            mapName = beatmap?.beatmapset?.title || beatmap?.beatmapset?.title_unicode || null;
            difficultyName = beatmap?.version || null;
            
            // Construct difficulty link
            const beatmapsetId = beatmap?.beatmapset_id || beatmap?.beatmapset?.id;
            if (beatmapsetId && beatmapId) {
              difficultyLink = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
            } else if (beatmapId) {
              difficultyLink = `https://osu.ppy.sh/beatmaps/${beatmapId}`;
            }
          }
        }
      } catch (error) {
        console.error('Error extracting beatmap data for edited message:', error);
        // Continue without map/difficulty info if there's an error
      }
      
      // Format message with map name and difficulty as link in parentheses (with star rating)
      const artist = beatmap?.beatmapset?.artist || beatmap?.beatmapset?.artist_unicode || '';
      let difficultyLabel = '';
      const starRatingText = await formatStarRating(beatmap);
      if (mapName && difficultyName && difficultyLink) {
        const label = formatDifficultyLabel(mapName, difficultyName, artist);
        difficultyLabel = `(${starRatingText}[${label}](${difficultyLink}))`;
      } else if (difficultyName && difficultyLink) {
        const label = formatDifficultyLabel('Unknown Map', difficultyName, artist);
        difficultyLabel = `(${starRatingText}[${label}](${difficultyLink}))`;
      } else if (difficultyLink) {
        difficultyLabel = `(${starRatingText}${difficultyLink})`;
      }
      
      // Format message - use user mention if available, otherwise use generic format
      const baseText = uid
        ? `<@${uid}> map of the day ${difficultyLabel} is voted to be meh... Teto is disappointed 😑\nBring something better next time!`
        : `This map of the day ${difficultyLabel} is voted to be meh... Teto is disappointed 😑\nBring something better next time!`;
      const newText = await formatTetoText(baseText);
      
      // Don't include image when message is downvoted
      try {
        await msg.edit({ embeds: await createEmbed(newText, null) });
      } catch (err) {
        console.error('Failed to edit message on meh vote:', err);
      }
    }
  } catch (err) {
    console.error('Reaction handling error:', err);
  }
});

// Helper: format challenge entry for weekly update
async function formatChallengeEntry(challenge) {
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

// Helper: calculate time held in days and hours
function calculateTimeHeld(updatedAt) {
  const now = new Date();
  const startTime = new Date(updatedAt);
  const diffMs = now - startTime;
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return { days, hours, totalHours };
}

// Helper: format challenge entry with time held (for defense streaks)
async function formatChallengeEntryWithDays(challenge, timeHeld) {
  try {
    const score = challenge.challengerScore;
    if (!score || typeof score !== 'object') {
      // Format time held
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
    
    // Format time held
    const timeStr = timeHeld.days > 0 
      ? `${timeHeld.days} ${timeHeld.days === 1 ? 'day' : 'days'} ${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`
      : `${timeHeld.hours} ${timeHeld.hours === 1 ? 'hour' : 'hours'}`;
    
    if (beatmapLink) {
      return `${starRatingText}[${difficultyLabel}](${beatmapLink}) - <@${challenge.challengerUserId}> [Held for ${timeStr}]`;
    }
    return `${starRatingText}**${difficultyLabel}** - <@${challenge.challengerUserId}> [Held for ${timeStr}]`;
  } catch (error) {
    console.error('Error formatting challenge entry with days:', error);
    // Fallback: try to calculate time even on error
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

// Weekly update function - processes challenges for a specific guild only
// This ensures stats are not mixed between different Discord servers
async function generateWeeklyUpdate(guildId) {
  try {
    // Get challenges from last 30 days for this specific guild only
    const challenges = await activeChallenges.getChallengesInLast30Days(guildId);
    if (challenges.length === 0) {
      return null; // No challenges to report
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Categorize challenges (all from this guild only)
    const newChampions = [];
    const uncontestedChallenges = [];

    for (const challenge of challenges) {
      // Verify challenge belongs to this guild (safety check)
      if (challenge.guildId !== guildId) {
        console.warn(`Challenge ${challenge.id} has mismatched guildId. Expected ${guildId}, got ${challenge.guildId}`);
        continue;
      }

      const createdAt = new Date(challenge.createdAt);
      const updatedAt = new Date(challenge.updatedAt);
      
      // New champions: ownership changed in last 30 days (updatedAt is recent and different from createdAt)
      if (updatedAt >= thirtyDaysAgo && updatedAt.getTime() !== createdAt.getTime()) {
        newChampions.push(challenge);
      }
      // Uncontested: created in last 30 days, no responses (challengerUserId === originalChallengerUserId and updatedAt === createdAt)
      // Safety check: originalChallengerUserId might be null for old challenges before migration
      else if (createdAt >= thirtyDaysAgo && 
               challenge.originalChallengerUserId && 
               challenge.challengerUserId === challenge.originalChallengerUserId && 
               updatedAt.getTime() === createdAt.getTime()) {
        uncontestedChallenges.push(challenge);
      }
    }

    // Get all active challenges for defense streaks - for this guild only
    // All active challenges are eligible, regardless of when they were created or if ownership changed
    const allChallenges = await activeChallenges.getAllChallengesForDefenseStreaks(guildId);
    
    // Calculate time held for each challenge (from updatedAt to now - when current champion took ownership)
    const challengesWithTimeHeld = allChallenges
      .filter(challenge => {
      // Verify challenge belongs to this guild (safety check)
      if (challenge.guildId !== guildId) {
        console.warn(`Challenge ${challenge.id} has mismatched guildId. Expected ${guildId}, got ${challenge.guildId}`);
        return false;
      }
        return true;
      })
      .map(challenge => {
        // Calculate time held from updatedAt (when current champion took ownership) to now
        const timeHeld = calculateTimeHeld(challenge.updatedAt);
        return { challenge, timeHeld };
      });
    
    // Sort by longest held time (descending - highest totalHours first)
    challengesWithTimeHeld.sort((a, b) => b.timeHeld.totalHours - a.timeHeld.totalHours);
    
    // Get top 5
    const topDefenseStreaks = challengesWithTimeHeld.slice(0, 5);

    // Format entries
    const newChampionsEntries = await Promise.all(newChampions.map(formatChallengeEntry));
    const uncontestedEntries = await Promise.all(uncontestedChallenges.map(formatChallengeEntry));
    const defenseStreakEntries = await Promise.all(
      topDefenseStreaks.map(({ challenge, timeHeld }) => formatChallengeEntryWithDays(challenge, timeHeld))
    );

    // Build message sections with bullet points
    const sections = [];
    
    if (newChampionsEntries.length > 0) {
      sections.push('🏆 **New champions:**');
      sections.push(...newChampionsEntries.map(entry => `• ${entry}`));
      sections.push(''); // Empty line
    }

    if (uncontestedEntries.length > 0) {
      sections.push('🫵 **New uncontested challenges:**');
      sections.push(...uncontestedEntries.map(entry => `• ${entry}`));
      sections.push(''); // Empty line
    }

    if (defenseStreakEntries.length > 0) {
      sections.push('🛡️ **Longest defence streak:**');
      sections.push(...defenseStreakEntries.map(entry => `• ${entry}`));
    }

    if (sections.length === 0) {
      return null; // No content to show
    }

    const header = await formatTetoText('**TETO WEEKLY UPDATE!**\n\n');
    const content = sections.join('\n');
    
    // Build full content with header
    const fullContent = header + content;
    
    // Use createEmbed to handle splitting - it will automatically split if content exceeds 4096 chars
    // and return an array of embeds
    // Note: No image URL passed here - weekly updates should not have beatmapset images
    const embeds = await createEmbed(fullContent);
    
    // Return array of embed arrays (each message can contain up to 10 embeds)
    // Since createEmbed already handles splitting, we just need to chunk embeds into groups of 10
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

client.login(TOKEN);
