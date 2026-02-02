import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
  EmbedBuilder,
  AttachmentBuilder,
} from 'discord.js';
import cron from 'node-cron';
import { commands } from './commands.js';
import { extractBeatmapId, getUserRecentScores, getUserBeatmapScore, getUserBeatmapScoresAll, getUser, getBeatmap, resolveMapOrScoreLink } from './osu-api.js';
import { buildBeatmapLinkFromIds, formatDifficultyLabel, getBeatmapAndLink } from './helpers.js';
import { initializeEmojis, formatRank, formatMapStatEmoji, formatTetoText } from './emoji.js';
import { extractScoreValue, formatMods, compareScores, formatBeatmapLink, getBeatmapsetImageUrl, isValidScore, getMapTitle, getMapArtist, formatStarRating, formatPlayerStats, formatPlayerStatsCompact, getBeatmapStatusName, isScoreSavedOnOsu, extractBeatmapInfoFromMessage, extractOsuProfile } from './scoreHelpers.js';
import { serverConfig as dbServerConfig, submissions, associations, activeChallenges, localScores, disconnect, prisma } from './db.js';
import { drawChallengeCard } from './card.js';
import { handleRsc, handleTc } from './commandHandlers.js';
import { runTestCommand } from './testHandlers.js';

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

// When ready
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const { rankEmojiCache, tetoEmoji } = await initializeEmojis(client, PARENT_GUILD_ID);
  console.log(`[Emoji] Initialized ${rankEmojiCache?.size || 0} rank emojis and ${tetoEmoji ? 'teto' : 'no teto'} emoji`);
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
  };
}

// Interaction handling
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'rsc') {
    return handleRsc(interaction, buildRscTcContext());
  }

  if (interaction.commandName === 'tc') {
    return handleTc(interaction, buildRscTcContext());
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
• \`/teto map submit\` — Submit your map of the day (optional mods)

**Challenges (\`/rsc\`):**
• No link: Use most recent score to issue or respond
• With link: Use your best score for that beatmap to issue or respond
• **Win rule:** 5 key stats (PP or 300s when both PP are 0, Accuracy, Max Combo, Score, Misses). Need **3+** to win. Response shows a comparison card and your stat count (X/5).
• Responding to your own challenge: better score → challenge updated; worse → "pretend Teto didn't see that"

**Score Tracking:**
• \`/trs\` — Record your most recent unranked/WIP score
• \`/tc\` — Look up your scores for a map (uses last 20 messages for link)

**Setup:**
• \`/teto setup\` — Set channel for TMOTD or Challenges (admin)
• \`/teto link\` — Link Discord to OSU! profile (required for most commands)
• \`/teto test\` — Test command UI (admin)
• \`/teto help\` — This message`;

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

      const handled = await runTestCommand(interaction, guildId, testCommand, buildTestContext());
      if (!handled) {
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
    // Support both difficulty links and score links
    const resolved = await resolveMapOrScoreLink(mapLink);
    const effectiveBeatmapId = resolved?.beatmapId ?? extractBeatmapId(mapLink);
    if (!effectiveBeatmapId) {
      return interaction.reply({ embeds: await createEmbed("Could not extract beatmap or score from the link. Use a difficulty link (e.g. osu.ppy.sh/b/123) or a score link (e.g. osu.ppy.sh/scores/123)."), ephemeral: true });
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
      if (effectiveBeatmapId) {
        const { beatmap: b, link } = await getBeatmapAndLink(effectiveBeatmapId);
        beatmap = b;
        if (beatmap) {
          mapName = beatmap?.beatmapset?.title || beatmap?.beatmapset?.title_unicode || null;
          difficultyName = beatmap?.version || null;
          imageUrl = await getBeatmapsetImageUrl(beatmap);
          if (link) difficultyLink = link;
        }
      }
    } catch (error) {
      console.error('Error getting beatmap data for map of the day:', error);
    }

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
          const resolved = await resolveMapOrScoreLink(mapLink);
          const beatmapId = resolved?.beatmapId ?? extractBeatmapId(mapLink);
          if (beatmapId) {
            const { beatmap: b, link } = await getBeatmapAndLink(beatmapId);
            beatmap = b;
            if (beatmap) {
              mapName = beatmap?.beatmapset?.title || beatmap?.beatmapset?.title_unicode || null;
              difficultyName = beatmap?.version || null;
              if (link) difficultyLink = link;
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
