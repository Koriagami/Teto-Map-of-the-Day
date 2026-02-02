/**
 * Shared helpers: beatmap link building, difficulty labels, fetch beatmap + link.
 */

import { getBeatmap } from './osu-api.js';

/**
 * Build osu.ppy.sh beatmap/difficulty URL from IDs.
 * @param {string|number|null} beatmapId
 * @param {string|number|null} beatmapsetId
 * @returns {string|null}
 */
export function buildBeatmapLinkFromIds(beatmapId, beatmapsetId) {
  if (beatmapsetId && beatmapId) {
    return `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#osu/${beatmapId}`;
  }
  if (beatmapId) {
    return `https://osu.ppy.sh/beatmaps/${beatmapId}`;
  }
  return null;
}

/**
 * Format difficulty label. Format: "artist - map name [difficulty]" when artist provided.
 * @param {string} mapTitle
 * @param {string} difficulty
 * @param {string} [artist='']
 * @returns {string}
 */
export function formatDifficultyLabel(mapTitle, difficulty, artist = '') {
  if (artist && String(artist).trim()) {
    return `${artist.trim()} - ${mapTitle} [${difficulty}]`;
  }
  return `${mapTitle} [${difficulty}]`;
}

/**
 * Fetch beatmap by ID and build its difficulty link.
 * @param {string} beatmapId
 * @returns {Promise<{ beatmap: object|null, link: string|null }>}
 */
export async function getBeatmapAndLink(beatmapId) {
  if (!beatmapId) return { beatmap: null, link: null };
  try {
    const beatmap = await getBeatmap(beatmapId);
    const beatmapsetId = beatmap?.beatmapset_id ?? beatmap?.beatmapset?.id;
    const link = buildBeatmapLinkFromIds(beatmapId, beatmapsetId);
    return { beatmap, link };
  } catch (error) {
    console.error('Error in getBeatmapAndLink:', error);
    return { beatmap: null, link: buildBeatmapLinkFromIds(beatmapId, null) };
  }
}
