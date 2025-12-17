import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
} from 'discord.js';
import { commands } from './commands.js';
import { extractBeatmapId, getBeatmap, getBeatmapScores, getUserRecentScores, getUserBeatmapScore, getUser } from './osu-api.js';
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
  if (uUsernameMatch) {
    return { userId: null, username: uUsernameMatch[1], profileLink };
  }

  // If it's just a username (no URL), assume it's a username
  const justUsername = profileLink.trim();
  if (justUsername && !justUsername.includes('http') && !justUsername.includes('/')) {
    return { userId: null, username: justUsername, profileLink: `https://osu.ppy.sh/users/${justUsername}` };
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

  // Handle /test command
  if (interaction.commandName === 'test') {
    await interaction.deferReply({ ephemeral: true });

    try {
      const mapLink = interaction.options.getString('maplink');
      const limit = interaction.options.getInteger('limit') || 10;

      // Extract beatmap ID from URL
      const beatmapId = extractBeatmapId(mapLink);
      if (!beatmapId) {
        return interaction.editReply({ content: 'Invalid beatmap link or ID. Please provide a valid osu.ppy.sh beatmap URL or beatmap ID.' });
      }

      // Get beatmap info and scores
      const [beatmap, scoresData] = await Promise.all([
        getBeatmap(beatmapId),
        getBeatmapScores(beatmapId, { limit })
      ]);

      if (!beatmap) {
        return interaction.editReply({ content: 'Beatmap not found.' });
      }

      const scores = scoresData.scores || [];
      if (scores.length === 0) {
        return interaction.editReply({ 
          content: `**${beatmap.beatmapset?.title || 'Unknown'}** - ${beatmap.version}\n\nNo scores found for this beatmap.` 
        });
      }

      // Format leaderboard
      let leaderboard = `**${beatmap.beatmapset?.title || 'Unknown'}** - ${beatmap.version}\n`;
      leaderboard += `**Difficulty:** ${beatmap.difficulty_rating}★ | **BPM:** ${beatmap.bpm} | **Length:** ${Math.floor(beatmap.total_length / 60)}:${String(beatmap.total_length % 60).padStart(2, '0')}\n\n`;
      leaderboard += `**Top ${scores.length} Scores:**\n\n`;

      scores.forEach((score, index) => {
        const rank = index + 1;
        const username = score.user?.username || 'Unknown';
        const pp = score.pp ? `${score.pp.toFixed(2)}pp` : 'N/A';
        const accuracy = score.accuracy ? `${(score.accuracy * 100).toFixed(2)}%` : 'N/A';
        const mods = score.mods && score.mods.length > 0 ? `+${score.mods.join('')}` : '';
        
        leaderboard += `${rank}. **${username}** - ${pp} (${accuracy}) ${mods}\n`;
        if (score.max_combo) {
          leaderboard += `   ${score.max_combo}x combo | ${score.statistics?.count_300 || 0}/${score.statistics?.count_100 || 0}/${score.statistics?.count_50 || 0}/${score.statistics?.count_miss || 0}\n`;
        }
      });

      // Discord message limit is 2000 characters
      if (leaderboard.length > 2000) {
        leaderboard = leaderboard.substring(0, 1997) + '...';
      }

      return interaction.editReply({ content: leaderboard });
    } catch (error) {
      console.error('Error in /test command:', error);
      return interaction.editReply({ 
        content: `Error fetching leaderboard: ${error.message}\n\nMake sure OSU_CLIENT_ID and OSU_CLIENT_SECRET are set in your .env file.` 
      });
    }
  }

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
        beatmapId = userScore.beatmap?.id?.toString();
        difficulty = userScore.beatmap?.version || 'Unknown';

        if (!beatmapId) {
          return interaction.editReply({ 
            content: 'Could not determine beatmap from your recent score.',
            ephemeral: true 
          });
        }

        // Check if challenge already exists
        existingChallenge = await activeChallenges.getByDifficulty(guildId, beatmapId, difficulty);
        
        if (existingChallenge) {
          // Challenge exists, proceed to PART B
          await interaction.editReply({ 
            content: 'There is already an active challenge for this diff.\nORA ORA! WE ARE ENTERING THE COMPETITION!'
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

          // Get operating channel
          const opChannelResult = await getOperatingChannel(guildId, interaction.guild);
          if (opChannelResult.error) {
            return interaction.editReply({ 
              content: opChannelResult.error,
              ephemeral: true 
            });
          }

          // Post challenge in operating channel
          const challengeMessage = `<@${userId}> has issued a challenge for the **${difficulty}**!\nBeat the score below and use \`/rsc\` command to respond!`;
          await opChannelResult.channel.send(challengeMessage);

          return interaction.editReply({ 
            content: `Challenge issued for **${difficulty}**! Check the operating channel.`
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

        // Check if user has score for this beatmap
        userScore = await getUserBeatmapScore(beatmapId, osuUserId);
        if (!userScore) {
          return interaction.editReply({ 
            content: 'You have no score for this beatmap. Play it first!',
            ephemeral: true 
          });
        }

        difficulty = userScore.beatmap?.version || 'Unknown';

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

          // Get operating channel
          const opChannelResult = await getOperatingChannel(guildId, interaction.guild);
          if (opChannelResult.error) {
            return interaction.editReply({ 
              content: opChannelResult.error,
              ephemeral: true 
            });
          }

          // Post challenge in operating channel
          const challengeMessage = `<@${userId}> has issued a challenge for the **${difficulty}**!\nBeat the score below and use \`/rsc\` command to respond!`;
          await opChannelResult.channel.send(challengeMessage);

          return interaction.editReply({ 
            content: 'Huh? Looks like we are uncontested on this diff! COME AND CHALLENGE US!'
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

      const responseMessage = `<@${userId}> has responded to the challenge on the **${challengeDifficulty}**!\nLet's see who is better!\n\n${comparison}`;

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
