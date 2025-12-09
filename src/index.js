import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField,
} from 'discord.js';
import { commands } from './commands.js';

// Config paths
const CONFIG_PATH = path.resolve('./teto_config.json');
const SUBMISSION_PATH = path.resolve('./teto_submissions.json');

// Load or initialize persistent JSON files
function loadJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// Persistent storage
let serverConfig = loadJSON(CONFIG_PATH, {}); // guildId -> operatingChannelId
let lastSubmission = loadJSON(SUBMISSION_PATH, {}); // key: `${guildId}:${userId}` -> YYYY-MM-DD

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

// When ready
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Interaction handling
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
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
    serverConfig[guildId] = channel.id;
    saveJSON(CONFIG_PATH, serverConfig);
    return interaction.reply({ content: `Teto configured! Operating channel set to <#${channel.id}>.`, ephemeral: true });
  }

  // /teto map submit
  if (subcommandGroup === 'map' && sub === 'submit') {
    const mapLink = interaction.options.getString('maplink');
    if (!mapLink || !mapLink.includes('osu.ppy.sh')) {
      return interaction.reply({ content: "Impossible to submit the map - link doesn't contain OSU! map", ephemeral: true });
    }
    const opChannelId = serverConfig[guildId];
    if (!opChannelId) {
      return interaction.reply({ content: 'Teto is not set up yet. Ask an admin to use /teto setup.', ephemeral: true });
    }

    const key = `${guildId}:${interaction.user.id}`;
    const last = lastSubmission[key];
    const today = todayString();
    if (last === today) {
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
      lastSubmission[key] = today;
      saveJSON(SUBMISSION_PATH, lastSubmission);
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
setInterval(() => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  if (h === 0 && m === 0 && lastResetDate !== dateStr) {
    // Only remove entries that are not from today (cleanup old data)
    const today = dateStr;
    const keys = Object.keys(lastSubmission);
    let cleaned = false;
    for (const key of keys) {
      if (lastSubmission[key] !== today) {
        delete lastSubmission[key];
        cleaned = true;
      }
    }
    if (cleaned) {
      saveJSON(SUBMISSION_PATH, lastSubmission);
      console.log('Daily submission limits reset - old entries cleaned.');
    }
    lastResetDate = dateStr;
  }
}, 60 * 1000); // every minute

client.login(TOKEN);
