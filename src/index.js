import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
} from 'discord.js';
import { commands } from './commands.js';
import { extractBeatmapId, getUserRecentScores, getUserBeatmapScore, getUser, getBeatmap } from './osu-api.js';
import { serverConfig as dbServerConfig, submissions, associations, activeChallenges, disconnect } from './db.js';

const VALID_MODS = ["EZ","NF","HT","HR","SD","PF","DT","NC","HD","FL","RL","SO","SV2"];

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

// Helper: today's date string YYYY-MM-DD
function todayString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Helper: get operating channel with validation
async function getOperatingChannel(guildId, guild) {
  const opChannelId = await dbServerConfig.get(guildId);
  if (!opChannelId) {
    return { error: 'Teto is not set up yet. Ask an admin to use /teto setup.' };
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

// Helper: compare two scores and format comparison table
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

  // Determine winners
  const ppWinner = responderPP > challengerPP ? responderName : (responderPP < challengerPP ? challengerUsername : 'Tie');
  const accWinner = responderAcc > challengerAcc ? responderName : (responderAcc < challengerAcc ? challengerUsername : 'Tie');
  const comboWinner = responderCombo > challengerCombo ? responderName : (responderCombo < challengerCombo ? challengerUsername : 'Tie');
  const scoreWinner = responderScoreValue > challengerScoreValue ? responderName : (responderScoreValue < challengerScoreValue ? challengerUsername : 'Tie');
  const missWinner = responderMiss < challengerMiss ? responderName : (responderMiss > challengerMiss ? challengerUsername : 'Tie');

  // Format comparison table
  let table = '```\n';
  table += 'Stat              | Challenger          | Responder\n';
  table += '------------------|---------------------|-------------------\n';
  table += `PP                | ${challengerPP.toFixed(2).padStart(17)} ${responderPP < challengerPP ? '🏆' : ''} | ${responderPP.toFixed(2).padStart(17)} ${responderPP > challengerPP ? '🏆' : ''}\n`;
  table += `Accuracy          | ${challengerAcc.toFixed(2).padStart(16)}% ${responderAcc < challengerAcc ? '🏆' : ''} | ${responderAcc.toFixed(2).padStart(16)}% ${responderAcc > challengerAcc ? '🏆' : ''}\n`;
  table += `Max Combo         | ${challengerCombo.toString().padStart(17)} ${responderCombo < challengerCombo ? '🏆' : ''} | ${responderCombo.toString().padStart(17)} ${responderCombo > challengerCombo ? '🏆' : ''}\n`;
  table += `Score             | ${challengerScoreValue.toLocaleString().padStart(17)} ${responderScoreValue < challengerScoreValue ? '🏆' : ''} | ${responderScoreValue.toLocaleString().padStart(17)} ${responderScoreValue > challengerScoreValue ? '🏆' : ''}\n`;
  table += `300s              | ${challenger300.toString().padStart(17)} ${responder300 < challenger300 ? '🏆' : ''} | ${responder300.toString().padStart(17)} ${responder300 > challenger300 ? '🏆' : ''}\n`;
  table += `100s              | ${challenger100.toString().padStart(17)} ${responder100 > challenger100 ? '🏆' : ''} | ${responder100.toString().padStart(17)} ${responder100 < challenger100 ? '🏆' : ''}\n`;
  table += `50s               | ${challenger50.toString().padStart(17)} ${responder50 > challenger50 ? '🏆' : ''} | ${responder50.toString().padStart(17)} ${responder50 < challenger50 ? '🏆' : ''}\n`;
  table += `Misses            | ${challengerMiss.toString().padStart(17)} ${responderMiss > challengerMiss ? '🏆' : ''} | ${responderMiss.toString().padStart(17)} ${responderMiss < challengerMiss ? '🏆' : ''}\n`;
  table += '```\n\n';

  // Summary
  let challengerWins = 0;
  let responderWins = 0;
  if (ppWinner === challengerUsername) challengerWins++; else if (ppWinner === responderName) responderWins++;
  if (accWinner === challengerUsername) challengerWins++; else if (accWinner === responderName) responderWins++;
  if (comboWinner === challengerUsername) challengerWins++; else if (comboWinner === responderName) responderWins++;
  if (scoreWinner === challengerUsername) challengerWins++; else if (scoreWinner === responderName) responderWins++;
  if (missWinner === challengerUsername) challengerWins++; else if (missWinner === responderName) responderWins++;

  table += `**Winner:** ${responderWins > challengerWins ? responderName : responderWins < challengerWins ? challengerUsername : 'Tie'} (${Math.max(responderWins, challengerWins)}/${challengerWins + responderWins} stats)`;

  return table;
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

// Helper: format player stats from score object
function formatPlayerStats(score) {
  // Safely extract score value - handle both number and object cases
  let scoreValue = 0;
  if (typeof score.score === 'number') {
    scoreValue = score.score;
  } else if (typeof score.score === 'object' && score.score !== null) {
    // Sometimes score might be nested in an object
    scoreValue = score.score.total || score.score.value || 0;
  }
  
  const rank = score.rank || 'N/A';
  const pp = typeof score.pp === 'number' ? score.pp : 0;
  const accuracy = typeof score.accuracy === 'number' ? (score.accuracy * 100) : 0;
  const maxCombo = typeof score.max_combo === 'number' ? score.max_combo : 0;
  const count300 = score.statistics?.count_300 || 0;
  const count100 = score.statistics?.count_100 || 0;
  const count50 = score.statistics?.count_50 || 0;
  const countMiss = score.statistics?.count_miss || 0;
  
  let stats = `**Score Stats:**\n`;
  stats += `• Rank: **${rank}**\n`;
  stats += `• PP: **${pp.toFixed(2)}**\n`;
  stats += `• Accuracy: **${accuracy.toFixed(2)}%**\n`;
  stats += `• Max Combo: **${maxCombo.toLocaleString()}**\n`;
  stats += `• Score: **${scoreValue.toLocaleString()}**\n`;
  stats += `• Hits: **${count300}**/${count100}/${count50}/**${countMiss}**\n\n`;
  
  return stats;
}

// Helper: extract OSU username/user ID from profile link
// Requires "osu.ppy.sh/users/" format
function extractOsuProfile(profileLink) {
  if (!profileLink) return null;

  // Must contain "osu.ppy.sh/users/" in the link
  if (!profileLink.includes('osu.ppy.sh/users/')) {
    return null;
  }

  // Try /users/{id} format
  const usersMatch = profileLink.match(/osu\.ppy\.sh\/users\/(\d+)/);
  if (usersMatch) {
    return { userId: usersMatch[1], username: null, profileLink };
  }

  // Try /users/{username} format
  const usernameMatch = profileLink.match(/osu\.ppy\.sh\/users\/([^\/\?#]+)/);
  if (usernameMatch) {
    return { userId: null, username: usernameMatch[1], profileLink };
  }

  return null;
}

// When ready
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
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
          content: 'This command can only be used in a server.',
          ephemeral: true 
        });
      }
      const userId = interaction.user.id;
      const respondForMapLink = interaction.options.getString('respond_for_map_link');

      // Check if user has association
      const association = await associations.get(guildId, userId);
      if (!association || !association.osuUserId) {
        return interaction.editReply({ 
          content: 'You need to link your Discord profile to your OSU! profile first. Use `/teto link` command to do so.',
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
            content: 'You have no recent scores. Play a map first!',
            ephemeral: true 
          });
        }

        userScore = recentScores[0];
        
        // Validate score object
        if (!isValidScore(userScore)) {
          return interaction.editReply({ 
            content: 'Invalid score data received from OSU API. Please play a map first and try again.',
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
          const difficultyLabel = `${mapTitle} [${difficulty}]`;
          await interaction.editReply({ 
            content: `There is already an active challenge for **${difficultyLabel}**.\nORA ORA! WE ARE ENTERING THE COMPETITION!`
          });
          // Continue to PART B below
        } else {
          // Create new challenge
          await activeChallenges.create(
            guildId,
            beatmapId,
            difficulty,
            userId,
            osuUserId,
            userScore
          );

          // Post challenge in the channel where command was invoked
          const beatmapLink = formatBeatmapLink(userScore);
          const playerStats = formatPlayerStats(userScore);
          const mapTitle = await getMapTitle(userScore);
          const difficultyLabel = `${mapTitle} [${difficulty}]`;
          const difficultyLink = beatmapLink ? `[${difficultyLabel}](${beatmapLink})` : `**${difficultyLabel}**`;
          
          const challengeMessage = `<@${userId}> has issued a challenge for ${difficultyLink}!\n\nBeat the score below and use \`/rsc\` command to respond!\n\n${playerStats}`;
          await interaction.channel.send(challengeMessage);

          return interaction.editReply({ 
            content: `Challenge issued for ${difficultyLink}!`
          });
        }
      } else {
        // With param - check if link contains osu.ppy.sh
        if (!respondForMapLink.includes('osu.ppy.sh')) {
          return interaction.editReply({ 
            content: 'Invalid map link. The link must contain "osu.ppy.sh".',
            ephemeral: true 
          });
        }

        beatmapId = extractBeatmapId(respondForMapLink);
        if (!beatmapId) {
          return interaction.editReply({ 
            content: 'Could not extract beatmap ID from the link.',
            ephemeral: true 
          });
        }

        // Get user's best score for this beatmap (not recent, but best)
        userScore = await getUserBeatmapScore(beatmapId, osuUserId);
        if (!userScore || !isValidScore(userScore)) {
          return interaction.editReply({ 
            content: 'You have no score for this beatmap. Play it first!',
            ephemeral: true 
          });
        }

        difficulty = userScore.beatmap.version;

        // Check if challenge exists
        existingChallenge = await activeChallenges.getByDifficulty(guildId, beatmapId, difficulty);
        
        if (!existingChallenge) {
          // Create new challenge
          await activeChallenges.create(
            guildId,
            beatmapId,
            difficulty,
            userId,
            osuUserId,
            userScore
          );

          // Post challenge in the channel where command was invoked
          const beatmapLink = formatBeatmapLink(userScore);
          const playerStats = formatPlayerStats(userScore);
          const mapTitle = await getMapTitle(userScore);
          const difficultyLabel = `${mapTitle} [${difficulty}]`;
          const difficultyLink = beatmapLink ? `[${difficultyLabel}](${beatmapLink})` : `**${difficultyLabel}**`;
          
          const challengeMessage = `<@${userId}> has issued a challenge for ${difficultyLink}!\n\nBeat the score below and use \`/rsc\` command to respond!\n\n${playerStats}`;
          await interaction.channel.send(challengeMessage);

          return interaction.editReply({ 
            content: `Huh? Looks like we are uncontested on **${difficultyLabel}**! COME AND CHALLENGE US!`
          });
        } else {
          // Challenge exists, proceed to PART B
          await interaction.editReply({ 
            content: 'ORA ORA! WE ARE ENTERING THE COMPETITION!'
          });
          // Continue to PART B below
        }
      }

      // PART B: Responding to challenge
      // At this point, we have existingChallenge and we need to compare scores
      if (!existingChallenge) {
        return interaction.editReply({ 
          content: 'No active challenge found. This should not happen.',
          ephemeral: true 
        });
      }

      // Get responder's score for the challenge beatmap
      // If we don't have it yet (responding without param), fetch it
      let responderScore = userScore;
      if (!responderScore || responderScore.beatmap?.id?.toString() !== existingChallenge.beatmapId) {
        responderScore = await getUserBeatmapScore(existingChallenge.beatmapId, osuUserId);
        if (!responderScore) {
          return interaction.editReply({ 
            content: 'You have no score for this beatmap. Play it first!',
            ephemeral: true 
          });
        }
      }

      const challengerScore = existingChallenge.challengerScore;
      const challengeDifficulty = existingChallenge.difficulty;

      // Ensure challengerScore is an object (Prisma JSON field)
      if (typeof challengerScore !== 'object' || challengerScore === null) {
        return interaction.editReply({ 
          content: 'Error: Challenge data is invalid. Please create a new challenge.',
          ephemeral: true 
        });
      }

      // Get map title and format difficulty label
      const mapTitle = await getMapTitle(challengerScore);
      const difficultyLabel = `${mapTitle} [${challengeDifficulty}]`;

      // Compare scores and create comparison table
      let comparison;
      try {
        comparison = compareScores(challengerScore, responderScore, interaction.user.username);
      } catch (error) {
        console.error('Error comparing scores:', error);
        return interaction.editReply({ 
          content: `Error comparing scores: ${error.message}`,
          ephemeral: true 
        });
      }

      const responseMessage = `<@${userId}> has responded to the challenge on **${difficultyLabel}**!\nLet's see who is better!\n\n${comparison}`;

      return interaction.editReply({ content: responseMessage });

    } catch (error) {
      console.error('Error in /rsc command:', error);
      return interaction.editReply({ 
        content: `Error: ${error.message}`,
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
      content: 'This command can only be used in a server.',
      ephemeral: true 
    });
  }
  const channel = interaction.channel;

  // /teto setup
  if (sub === 'setup') {
    // only admins
    const memberPerms = interaction.memberPermissions;
    if (!memberPerms || !memberPerms.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Only administrators can run this command.', ephemeral: true });
    }
    await dbServerConfig.set(guildId, channel.id);
    return interaction.reply({ content: `Teto configured! Operating channel set to <#${channel.id}>.`, ephemeral: true });
  }

  // /teto link
  if (sub === 'link') {
    const profileLink = interaction.options.getString('profilelink');
    
    // Validate link format - must contain "osu.ppy.sh/users/"
    if (!profileLink || !profileLink.includes('osu.ppy.sh/users/')) {
      return interaction.reply({ 
        content: 'Invalid OSU! profile link. The link must contain "osu.ppy.sh/users/" in it.\nExample: https://osu.ppy.sh/users/12345 or https://osu.ppy.sh/users/username', 
        ephemeral: true 
      });
    }

    const profileInfo = extractOsuProfile(profileLink);

    if (!profileInfo) {
      return interaction.reply({ 
        content: 'Invalid OSU! profile link format. Please provide a valid link like:\n- https://osu.ppy.sh/users/12345\n- https://osu.ppy.sh/users/username', 
        ephemeral: true 
      });
    }

    // Check if Discord user already has a profile linked
    const existingAssociation = await associations.get(guildId, interaction.user.id);
    if (existingAssociation) {
      const existingDisplayName = existingAssociation.osuUsername || `User ${existingAssociation.osuUserId}`;
      return interaction.reply({ 
        content: `You already have an OSU! profile linked: **${existingDisplayName}**\nProfile: ${existingAssociation.profileLink}\n\nTo link a different profile, please contact an administrator.`, 
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
        content: `This OSU! profile is already linked to another Discord user (<@${existingOsuLink.discordUserId}>).\nEach OSU! profile can only be linked to one Discord account per server.`, 
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
          content: `The OSU! profile you provided does not exist.\nPlease check the link and try again.` 
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
        content: `✅ Successfully linked your Discord account to OSU! profile: **${verifiedUsername}**\nProfile: ${verifiedProfileLink}` 
      });
    } catch (error) {
      console.error('Error verifying OSU profile:', error);
      return interaction.editReply({ 
        content: `Error verifying OSU! profile: ${error.message}\nPlease try again later.` 
      });
    }
  }

  // /teto map submit
  if (subcommandGroup === 'map' && sub === 'submit') {
    const mapLink = interaction.options.getString('maplink');
    if (!mapLink || !mapLink.includes('osu.ppy.sh')) {
      return interaction.reply({ content: "Impossible to submit the map - link doesn't contain OSU! map", ephemeral: true });
    }
    const today = todayString();
    const hasSubmitted = await submissions.hasSubmittedToday(guildId, interaction.user.id, today);
    if (hasSubmitted) {
      return interaction.reply({ content: 'You already submitted a map today!', ephemeral: true });
    }

    // collect mods
    const mods = [];
    for (let i = 1; i <= 5; i++) {
      const mod = interaction.options.getString(`recommended_mod_${i}`);
      if (mod) mods.push(mod);
    }

    // fetch op channel
    const opChannelResult = await getOperatingChannel(guildId, interaction.guild);
    if (opChannelResult.error) {
      return interaction.reply({ content: opChannelResult.error, ephemeral: true });
    }
    const opChannel = opChannelResult.channel;
    const opChannelId = opChannelResult.channelId;

    let msgContent = `<@${interaction.user.id}> map of the day is - ${mapLink}`;
    if (mods.length > 0) {
      msgContent += `\nRecommended mods: ${mods.join(', ')}`;
    }

    try {
      const sent = await opChannel.send(msgContent);
      // bot adds its own reactions (non-critical if this fails)
      try {
        await sent.react('👍');
        await sent.react('👎');
      } catch (reactErr) {
        console.warn('Failed to add reactions to submission (non-critical):', reactErr);
      }
      // store submission
      await submissions.create(guildId, interaction.user.id, today);
      return interaction.reply({ content: `Map submitted to <#${opChannelId}>!`, ephemeral: true });
    } catch (err) {
      console.error('Failed to post submission:', err);
      return interaction.reply({ content: 'Failed to submit the map. Check bot permissions in the operating channel.', ephemeral: true });
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

    // Only monitor reactions in operating channels
    const opChannelId = await dbServerConfig.get(msg.guildId);
    if (!opChannelId || msg.channelId !== opChannelId) return;

    // Skip if message was already edited (contains "voted to be meh")
    if (msg.content.includes('voted to be meh')) return;

    // count users who reacted with 👎 (includes bot if it reacted)
    const users = await reaction.users.fetch();
    const count = users.size;
    if (count >= 4) {
      // try to extract original submitter id from message start
      const matcher = msg.content.match(/^<@!?(\d+)>/);
      let uid = null;
      if (matcher) {
        uid = matcher[1];
      }
      const newText = uid
        ? `<@${uid}> map of the day is voted to be meh... Teto is disappointed 😑\nBring something better next time!`
        : `This map of the day is voted to be meh... Teto is disappointed 😑\nBring something better next time!`;
      try {
        await msg.edit(newText);
      } catch (err) {
        console.error('Failed to edit message on meh vote:', err);
      }
    }
  } catch (err) {
    console.error('Reaction handling error:', err);
  }
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
