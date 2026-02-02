/**
 * Emoji caching and formatting: rank emojis, map stat emojis, teto emoji.
 * Call initializeEmojis(client, parentGuildId) on ready; then use formatRank, formatMapStatEmoji, formatTetoText.
 */

let rankEmojiCache = null;
let tetoEmoji = null;
let mapStatsEmojiCache = null;

/**
 * Find and cache emojis from parent guild (or all guilds if parent not set).
 * @param {import('discord.js').Client} client
 * @param {string|undefined} parentGuildId - Optional guild ID for emoji source
 */
export async function initializeEmojis(client, parentGuildId) {
  if (rankEmojiCache && tetoEmoji !== null && mapStatsEmojiCache) {
    return { rankEmojiCache, tetoEmoji, mapStatsEmojiCache };
  }

  rankEmojiCache = new Map();
  mapStatsEmojiCache = new Map();
  const rankNames = ['F', 'D', 'C', 'B', 'A', 'S', 'SH', 'SS', 'SSH', 'X', 'XH'];
  const mapStatsNames = ['cs', 'ar', 'bpm', 'od', 'hp'];

  try {
    let targetGuild = null;

    if (parentGuildId) {
      try {
        targetGuild = await client.guilds.fetch(parentGuildId);
        console.log(`[Emoji] Using parent guild: ${targetGuild.name} (${parentGuildId})`);
      } catch (error) {
        console.error(`[Emoji] Failed to fetch parent guild ${parentGuildId}:`, error);
        console.log(`[Emoji] Falling back to searching all guilds...`);
      }
    }

    const guildsToSearch = targetGuild ? [targetGuild] : Array.from(client.guilds.cache.values());

    for (const guild of guildsToSearch) {
      try {
        const emojis = await guild.emojis.fetch();
        for (const [emojiId, emoji] of emojis) {
          const emojiName = emoji.name?.toLowerCase();

          if (emojiName && emojiName.startsWith('rank_')) {
            const rankLetter = emojiName.replace('rank_', '').toUpperCase();
            if (rankNames.includes(rankLetter) && !rankEmojiCache.has(rankLetter)) {
              rankEmojiCache.set(rankLetter, emoji);
              console.log(`[Emoji] Found emoji for rank ${rankLetter} from guild ${guild.name}: ${emoji.name} (ID: ${emoji.id})`);
            }
          }

          if (emojiName && mapStatsNames.includes(emojiName) && !mapStatsEmojiCache.has(emojiName)) {
            mapStatsEmojiCache.set(emojiName, emoji);
            console.log(`[Emoji] Found emoji for map stat ${emojiName} from guild ${guild.name}: ${emoji.name} (ID: ${emoji.id})`);
          }

          if (emojiName === 'teto' && !tetoEmoji) {
            tetoEmoji = emoji;
            console.log(`[Emoji] Found teto emoji from guild ${guild.name}: ${emoji.name} (ID: ${emoji.id})`);
          }
        }
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

/**
 * Format rank with emoji (lazy-init if cache not ready).
 */
export async function formatRank(rank) {
  if (!rank || rank === 'N/A') return 'N/A';

  const rankUpper = String(rank).toUpperCase();

  if (!rankEmojiCache) {
    return `:rank_${rankUpper}:`;
  }

  if (rankEmojiCache.has(rankUpper)) {
    const emoji = rankEmojiCache.get(rankUpper);
    return emoji.toString();
  }

  return `:rank_${rankUpper}:`;
}

/**
 * Format map stat emoji (cs, ar, bpm, od, hp).
 */
export async function formatMapStatEmoji(statName) {
  const statLower = String(statName).toLowerCase();

  if (!mapStatsEmojiCache) {
    return `:${statLower}:`;
  }

  if (mapStatsEmojiCache.has(statLower)) {
    const emoji = mapStatsEmojiCache.get(statLower);
    return emoji.toString();
  }

  return `:${statLower}:`;
}

/**
 * Replace "Teto" with emoji + "Teto" in text.
 */
export async function formatTetoText(text) {
  if (!text || typeof text !== 'string') return text;

  const tetoRegex = /\bTeto\b/g;

  if (tetoEmoji) {
    return text.replace(tetoRegex, `${tetoEmoji.toString()} Teto`);
  }

  return text.replace(tetoRegex, `:teto: Teto`);
}
