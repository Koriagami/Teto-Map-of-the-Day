/**
 * MessageReactionAdd handler: when 👎 reaches 4+ on a message in TMOTD/Challenges channel,
 * edit the message to "voted to be meh" and remove the image.
 */

import { serverConfig as dbServerConfig } from './db.js';
import { resolveMapOrScoreLink, extractBeatmapId } from './osu-api.js';
import { getBeatmapAndLink, formatDifficultyLabel } from './helpers.js';
import { formatTetoText } from './emoji.js';
import { formatStarRating } from './scoreHelpers.js';

/**
 * Handle MessageReactionAdd (👎 on operating channel messages).
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 * @param {{ createEmbed: (content: string, imageUrl?: string) => Promise<import('discord.js').EmbedBuilder[]> }} ctx - createEmbed from index
 */
export async function handleMessageReactionAdd(reaction, user, ctx) {
  try {
    if (reaction.partial) await reaction.fetch();
    if (user.bot) return;
    const msg = reaction.message;
    if (!msg || !msg.guildId) return;
    if (reaction.emoji.name !== '👎') return;

    const config = await dbServerConfig.get(msg.guildId);
    if (!config) return;

    const tmotdChannelId = config.tmotdChannelId;
    const challengesChannelId = config.challengesChannelId;

    if (msg.channelId !== tmotdChannelId && msg.channelId !== challengesChannelId) return;

    if (msg.content.includes('voted to be meh')) return;

    const users = await reaction.users.fetch();
    const count = users.size;
    if (count >= 4) {
      let uid = null;

      let messageText = msg.content || '';
      if (msg.embeds && msg.embeds.length > 0 && msg.embeds[0].description) {
        messageText = (messageText + ' ' + msg.embeds[0].description).trim();
      }

      const matcher = messageText.match(/^<@!?(\d+)>/);
      if (matcher) {
        uid = matcher[1];
      }

      let mapName = null;
      let difficultyName = null;
      let difficultyLink = null;
      let beatmap = null;

      try {
        let mapLink = null;

        const markdownLinkMatch = messageText.match(/\[([^\]]+)\]\((https?:\/\/osu\.ppy\.sh\/[^\)]+)\)/);
        if (markdownLinkMatch) {
          mapLink = markdownLinkMatch[2];
        } else {
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
      }

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

      const baseText = uid
        ? `<@${uid}> map of the day ${difficultyLabel} is voted to be meh... Teto is disappointed 😑\nBring something better next time!`
        : `This map of the day ${difficultyLabel} is voted to be meh... Teto is disappointed 😑\nBring something better next time!`;
      const newText = await formatTetoText(baseText);

      try {
        await msg.edit({ embeds: await ctx.createEmbed(newText, null) });
      } catch (err) {
        console.error('Failed to edit message on meh vote:', err);
      }
    }
  } catch (err) {
    console.error('Reaction handling error:', err);
  }
}
