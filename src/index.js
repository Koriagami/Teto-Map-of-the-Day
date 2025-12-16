import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
} from 'discord.js';
import { commands } from './commands.js';
import { extractBeatmapId, getBeatmap, getBeatmapScores } from './osu-api.js';
import { serverConfig as dbServerConfig, submissions, associations, disconnect } from './db.js';

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

// Helper: extract OSU username/user ID from profile link
function extractOsuProfile(profileLink) {
  if (!profileLink) return null;

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

  // Try /u/{id} format
  const uMatch = profileLink.match(/osu\.ppy\.sh\/u\/(\d+)/);
  if (uMatch) {
    return { userId: uMatch[1], username: null, profileLink };
  }

  // Try /u/{username} format
  const uUsernameMatch = profileLink.match(/osu\.ppy\.sh\/u\/([^\/\?#]+)/);
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

  // Handle /teto commands
  if (interaction.commandName !== 'teto') return;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  const guildId = interaction.guildId;
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
    const profileInfo = extractOsuProfile(profileLink);

    if (!profileInfo) {
      return interaction.reply({ 
        content: 'Invalid OSU! profile link. Please provide a valid link like:\n- https://osu.ppy.sh/users/12345\n- https://osu.ppy.sh/users/username\n- Or just your username', 
        ephemeral: true 
      });
    }

    await associations.set(guildId, interaction.user.id, {
      discordUsername: interaction.user.username,
      osuUsername: profileInfo.username,
      osuUserId: profileInfo.userId,
      profileLink: profileInfo.profileLink,
    });

    const displayName = profileInfo.username || `User ${profileInfo.userId}`;
    return interaction.reply({ 
      content: `✅ Successfully linked your Discord account to OSU! profile: **${displayName}**\nProfile: ${profileInfo.profileLink}`, 
      ephemeral: true 
    });
  }

  // /teto map submit
  if (subcommandGroup === 'map' && sub === 'submit') {
    const mapLink = interaction.options.getString('maplink');
    if (!mapLink || !mapLink.includes('osu.ppy.sh')) {
      return interaction.reply({ content: "Impossible to submit the map - link doesn't contain OSU! map", ephemeral: true });
    }
    const opChannelId = await dbServerConfig.get(guildId);
    if (!opChannelId) {
      return interaction.reply({ content: 'Teto is not set up yet. Ask an admin to use /teto setup.', ephemeral: true });
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
    const guild = interaction.guild;
    let opChannel;
    try {
      opChannel = await guild.channels.fetch(opChannelId);
    } catch (err) {
      console.error('Failed to fetch operating channel', err);
    }
    if (!opChannel) {
      return interaction.reply({ content: 'Operating channel is invalid. Re-run setup.', ephemeral: true });
    }

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
    const opChannelId = serverConfig[msg.guildId];
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
