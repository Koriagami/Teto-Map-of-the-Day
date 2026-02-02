/**
 * Score, challenge, and beatmap helpers: comparison, formatting, validation, extraction.
 */

import { getBeatmap, extractBeatmapId } from './osu-api.js';
import { buildBeatmapLinkFromIds } from './helpers.js';
import { formatRank, formatMapStatEmoji } from './emoji.js';

export function extractScoreValue(score) {
  if (typeof score.score === 'number') {
    return score.score;
  } else if (typeof score.score === 'object' && score.score !== null) {
    return score.score.total || score.score.value || 0;
  }
  return 0;
}

export function formatMods(score) {
  if (!score || typeof score !== 'object') return 'No mods';

  if (Array.isArray(score.mods) && score.mods.length > 0) {
    const modAcronyms = score.mods
      .map(mod => (typeof mod === 'object' && mod.acronym) ? mod.acronym : (typeof mod === 'string' ? mod : null))
      .filter(Boolean);
    return modAcronyms.length > 0 ? modAcronyms.join(', ') : 'No mods';
  }

  if (typeof score.mods_string === 'string' && score.mods_string.length > 0) {
    return score.mods_string;
  }

  if (typeof score.mods === 'string' && score.mods.length > 0) {
    return score.mods;
  }

  return 'No mods';
}

export function scoreStat(score, key) {
  const s = score?.statistics;
  const v = s?.[key] ?? score?.[key];
  return Number(v) || 0;
}

/**
 * Compare two scores; return table, responderWins, challengerWins, totalMetrics, statWinners.
 */
export function compareScores(challengerScore, responderScore, responderUsername) {
  if (!challengerScore || !responderScore || typeof challengerScore !== 'object' || typeof responderScore !== 'object') {
    throw new Error('Invalid score data provided for comparison');
  }

  const challengerUsername = (challengerScore.user?.username || 'Challenger').toString().trim();
  const responderName = (responderUsername || '').toString().trim();
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  const challengerPP = Number(challengerScore.pp) || 0;
  const responderPP = Number(responderScore.pp) || 0;
  const challengerCombo = Number(challengerScore.max_combo) || 0;
  const responderCombo = Number(responderScore.max_combo) || 0;
  const challengerScoreValue = Number(extractScoreValue(challengerScore)) || 0;
  const responderScoreValue = Number(extractScoreValue(responderScore)) || 0;
  const challengerAccPct = (Number(challengerScore.accuracy) || 0) * 100;
  const responderAccPct = (Number(responderScore.accuracy) || 0) * 100;

  const challenger300 = scoreStat(challengerScore, 'count_300');
  const responder300 = scoreStat(responderScore, 'count_300');
  const challenger100 = scoreStat(challengerScore, 'count_100');
  const responder100 = scoreStat(responderScore, 'count_100');
  const challenger50 = scoreStat(challengerScore, 'count_50');
  const responder50 = scoreStat(responderScore, 'count_50');
  const challengerMiss = scoreStat(challengerScore, 'count_miss');
  const responderMiss = scoreStat(responderScore, 'count_miss');

  const challengerMods = formatMods(challengerScore);
  const responderMods = formatMods(responderScore);

  const bothPPZero = challengerPP == 0 && responderPP == 0;
  const ppWinner = responderPP > challengerPP ? responderName : (responderPP < challengerPP ? challengerUsername : 'Tie');
  const accWinner = responderAccPct > challengerAccPct ? responderName : (responderAccPct < challengerAccPct ? challengerUsername : 'Tie');
  const comboWinner = responderCombo > challengerCombo ? responderName : (responderCombo < challengerCombo ? challengerUsername : 'Tie');
  const scoreWinner = responderScoreValue > challengerScoreValue ? responderName : (responderScoreValue < challengerScoreValue ? challengerUsername : 'Tie');
  const missWinner = responderMiss < challengerMiss ? responderName : (responderMiss > challengerMiss ? challengerUsername : 'Tie');
  const fifthMetricWinner = bothPPZero
    ? (responder300 > challenger300 ? responderName : (responder300 < challenger300 ? challengerUsername : 'Tie'))
    : ppWinner;

  // Per-stat winner by side (right=responder, left=challenger) — used so own-challenge improvements show correct stats
  const statWinners = [
    'tie',
    responderPP > challengerPP ? 'right' : responderPP < challengerPP ? 'left' : 'tie',
    responderAccPct > challengerAccPct ? 'right' : responderAccPct < challengerAccPct ? 'left' : 'tie',
    responderCombo > challengerCombo ? 'right' : responderCombo < challengerCombo ? 'left' : 'tie',
    responderScoreValue > challengerScoreValue ? 'right' : responderScoreValue < challengerScoreValue ? 'left' : 'tie',
    responderMiss < challengerMiss ? 'right' : responderMiss > challengerMiss ? 'left' : 'tie',
    responder300 > challenger300 ? 'right' : responder300 < challenger300 ? 'left' : 'tie',
    responder100 < challenger100 ? 'right' : responder100 > challenger100 ? 'left' : 'tie',
    responder50 < challenger50 ? 'right' : responder50 > challenger50 ? 'left' : 'tie',
  ];
  const fifthKeyIndex = bothPPZero ? 6 : 1;
  const keyStatIndices = [fifthKeyIndex, 2, 3, 4, 5];
  let responderWins = 0;
  let challengerWins = 0;
  for (const i of keyStatIndices) {
    if (statWinners[i] === 'right') responderWins++;
    else if (statWinners[i] === 'left') challengerWins++;
  }
  const totalMetrics = responderWins + challengerWins;

  let table = '```\n';
  table += 'Stat              | Challenger          | Responder\n';
  table += '------------------|---------------------|-------------------\n';
  table += `PP                | ${challengerPP.toFixed(2).padStart(17)} ${!bothPPZero && responderPP < challengerPP ? '🏆' : ''} | ${responderPP.toFixed(2).padStart(17)} ${!bothPPZero && responderPP > challengerPP ? '🏆' : ''}\n`;
  table += `Accuracy          | ${challengerAccPct.toFixed(2).padStart(16)}% ${responderAccPct < challengerAccPct ? '🏆' : ''} | ${responderAccPct.toFixed(2).padStart(16)}% ${responderAccPct > challengerAccPct ? '🏆' : ''}\n`;
  table += `Max Combo         | ${challengerCombo.toString().padStart(17)} ${responderCombo < challengerCombo ? '🏆' : ''} | ${responderCombo.toString().padStart(17)} ${responderCombo > challengerCombo ? '🏆' : ''}\n`;
  table += `Score             | ${challengerScoreValue.toLocaleString().padStart(17)} ${responderScoreValue < challengerScoreValue ? '🏆' : ''} | ${responderScoreValue.toLocaleString().padStart(17)} ${responderScoreValue > challengerScoreValue ? '🏆' : ''}\n`;
  table += `Misses            | ${challengerMiss.toString().padStart(17)} ${responderMiss > challengerMiss ? '🏆' : ''} | ${responderMiss.toString().padStart(17)} ${responderMiss < challengerMiss ? '🏆' : ''}\n`;
  table += `300s              | ${challenger300.toString().padStart(17)} ${bothPPZero && responder300 < challenger300 ? '🏆' : ''} | ${responder300.toString().padStart(17)} ${bothPPZero && responder300 > challenger300 ? '🏆' : ''}\n`;
  table += `100s              | ${challenger100.toString().padStart(17)} | ${responder100.toString().padStart(17)}\n`;
  table += `50s               | ${challenger50.toString().padStart(17)} | ${responder50.toString().padStart(17)}\n`;
  const challengerModsFormatted = challengerMods.length > 17 ? challengerMods.substring(0, 14) + '...' : challengerMods;
  const responderModsFormatted = responderMods.length > 17 ? responderMods.substring(0, 14) + '...' : responderMods;
  table += `Mods              | ${challengerModsFormatted.padStart(17)} | ${responderModsFormatted.padStart(17)}\n`;
  table += '```\n\n';
  table += `**Winner:** ${responderWins > challengerWins ? responderName : responderWins < challengerWins ? challengerUsername : 'Tie'} (${Math.max(responderWins, challengerWins)}/${totalMetrics} stats)\n`;

  return {
    table,
    responderWins,
    challengerWins,
    totalMetrics,
    statWinners,
  };
}

export function formatBeatmapLink(score) {
  const beatmapId = score.beatmap?.id;
  const beatmapsetId = score.beatmap?.beatmapset_id;
  return buildBeatmapLinkFromIds(beatmapId, beatmapsetId);
}

export async function getBeatmapsetImageUrl(scoreOrBeatmap) {
  try {
    let beatmapsetId = scoreOrBeatmap?.beatmap?.beatmapset_id
      || scoreOrBeatmap?.beatmapset_id
      || scoreOrBeatmap?.beatmapset?.id;

    if (beatmapsetId) {
      return `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/card.jpg`;
    }

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

export function isValidScore(score) {
  if (!score || typeof score !== 'object') {
    return false;
  }
  if (!score.beatmap || !score.beatmap.id) {
    return false;
  }
  if (typeof score.score !== 'number' && (typeof score.score !== 'object' || score.score === null)) {
    return false;
  }
  if (!score.beatmap.version) {
    return false;
  }
  return true;
}

export async function getMapTitle(score) {
  const title = score.beatmap?.beatmapset?.title
    || score.beatmap?.beatmapset?.title_unicode
    || score.beatmapset?.title
    || score.beatmapset?.title_unicode;

  if (title) return title;

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

export async function getMapArtist(scoreOrBeatmap) {
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

export async function getStarRating(scoreOrBeatmap) {
  let starRating = scoreOrBeatmap?.beatmap?.difficulty_rating
    || scoreOrBeatmap?.beatmap?.stars
    || scoreOrBeatmap?.difficulty_rating
    || scoreOrBeatmap?.stars
    || null;

  if (starRating == null && scoreOrBeatmap?.beatmap?.id) {
    try {
      const beatmap = await getBeatmap(scoreOrBeatmap.beatmap.id);
      starRating = beatmap?.difficulty_rating || beatmap?.stars || null;
    } catch (error) {
      console.error('Error fetching beatmap for star rating:', error);
    }
  }

  return starRating;
}

export async function formatStarRating(scoreOrBeatmap) {
  if (!scoreOrBeatmap) return '';
  const starRating = await getStarRating(scoreOrBeatmap);
  if (starRating != null) {
    return `**:star: ${starRating.toFixed(2)}** `;
  }
  return '';
}

export async function formatPlayerStats(score) {
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

  let cs = score.beatmap?.cs ?? score.beatmap?.circle_size ?? null;
  let ar = score.beatmap?.ar ?? score.beatmap?.approach_rate ?? null;
  let bpm = score.beatmap?.bpm ?? null;
  let od = score.beatmap?.accuracy ?? score.beatmap?.overall_difficulty ?? null;
  let hp = score.beatmap?.drain ?? score.beatmap?.hp ?? score.beatmap?.health ?? null;

  if ((cs == null || ar == null || bpm == null || od == null || hp == null) && score.beatmap?.id) {
    try {
      const beatmap = await getBeatmap(score.beatmap.id);
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

export async function formatPlayerStatsCompact(score) {
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

export function getBeatmapStatusName(status) {
  const statusStr = String(status).toLowerCase();
  const stringStatusMap = {
    'graveyard': 'Graveyard',
    'wip': 'WIP',
    'pending': 'Pending',
    'ranked': 'Ranked',
    'approved': 'Approved',
    'qualified': 'Qualified',
    'loved': 'Loved',
  };
  if (stringStatusMap[statusStr]) return stringStatusMap[statusStr];
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

export function isScoreSavedOnOsu(status) {
  const statusStr = String(status).toLowerCase();
  if (['ranked', 'approved', 'qualified', 'loved'].includes(statusStr)) return true;
  if (['graveyard', 'wip', 'pending'].includes(statusStr)) return false;
  const statusNum = typeof status === 'string' ? parseInt(status, 10) : status;
  return statusNum >= 1 && statusNum <= 4;
}

/**
 * Extract beatmap ID and difficulty from message content (osu.ppy.sh links).
 */
export function extractBeatmapInfoFromMessage(messageContent) {
  if (!messageContent) return null;

  const foundLinks = [];
  let bracketStart = -1;
  let bracketCount = 0;
  for (let i = 0; i < messageContent.length; i++) {
    if (messageContent[i] === '[') {
      if (bracketCount === 0) bracketStart = i;
      bracketCount++;
    } else if (messageContent[i] === ']') {
      bracketCount--;
      if (bracketCount === 0 && bracketStart !== -1) {
        if (i + 1 < messageContent.length && messageContent[i + 1] === '(') {
          let parenCount = 1;
          let j = i + 2;
          while (j < messageContent.length && parenCount > 0) {
            if (messageContent[j] === '(') parenCount++;
            else if (messageContent[j] === ')') parenCount--;
            j++;
          }
          if (parenCount === 0) {
            const linkText = messageContent.substring(bracketStart + 1, i);
            const linkUrl = messageContent.substring(i + 2, j - 1);
            if (linkUrl.includes('osu.ppy.sh')) {
              foundLinks.push({ type: 'markdown', linkText, linkUrl, linkStart: bracketStart, linkEnd: j - 1 });
            }
          }
        }
        bracketStart = -1;
      }
    }
  }

  const plainLinkRegex = /https?:\/\/osu\.ppy\.sh\/[^\s\)]+/g;
  for (const match of messageContent.matchAll(plainLinkRegex)) {
    foundLinks.push({ type: 'plain', linkText: null, linkUrl: match[0], linkStart: match.index, linkEnd: match.index + match[0].length });
  }

  foundLinks.sort((a, b) => a.linkStart - b.linkStart);

  for (const linkInfo of foundLinks) {
    const url = linkInfo.linkUrl;
    const isShortFormat = /osu\.ppy\.sh\/b\/\d+/.test(url);
    const isFullBeatmapsetFormat = /beatmapsets\/\d+#\w+\/\d+/.test(url);
    const isBeatmapsFormat = /osu\.ppy\.sh\/beatmaps\/\d+/.test(url);
    const isScoreLink = /osu\.ppy\.sh\/scores\/\d+/.test(url);

    if (!isShortFormat && !isFullBeatmapsetFormat && !isBeatmapsFormat && !isScoreLink) continue;
    if (isScoreLink) continue;

    const beatmapId = extractBeatmapId(url);
    if (!beatmapId) continue;

    let difficulty = null;

    if (linkInfo.type === 'markdown') {
      const linkText = linkInfo.linkText;
      const lastBracketEnd = linkText.lastIndexOf(']');
      if (lastBracketEnd !== -1 && lastBracketEnd > 0) {
        let diffBracketCount = 1;
        let pos = lastBracketEnd - 1;
        while (pos >= 0 && diffBracketCount > 0) {
          if (linkText[pos] === ']') diffBracketCount++;
          else if (linkText[pos] === '[') diffBracketCount--;
          pos--;
        }
        if (diffBracketCount === 0 && pos >= -1) {
          difficulty = linkText.substring(pos + 2, lastBracketEnd);
        }
      }
    } else {
      const searchStart = Math.max(0, linkInfo.linkStart - 200);
      const searchEnd = Math.min(messageContent.length, linkInfo.linkEnd + 200);
      const searchArea = messageContent.substring(searchStart, searchEnd);
      const allBrackets = [];
      let bs = -1;
      let bc = 0;
      for (let i = 0; i < searchArea.length; i++) {
        if (searchArea[i] === '[') {
          if (bc === 0) bs = i;
          bc++;
        } else if (searchArea[i] === ']') {
          bc--;
          if (bc === 0 && bs !== -1) {
            const bracketContent = searchArea.substring(bs + 1, i);
            if (searchArea[i + 1] !== '(') {
              allBrackets.push({ content: bracketContent, position: searchStart + bs });
            }
            bs = -1;
          }
        }
      }
      if (allBrackets.length > 0) {
        allBrackets.sort((a, b) => {
          const distA = Math.abs(a.position - (linkInfo.linkStart - searchStart));
          const distB = Math.abs(b.position - (linkInfo.linkStart - searchStart));
          return distA - distB;
        });
        difficulty = allBrackets[0].content;
      }
    }

    if (beatmapId) {
      return { beatmapId, difficulty: difficulty || null };
    }
  }

  return null;
}

export function extractOsuProfile(profileLink) {
  if (!profileLink || !profileLink.includes('osu.ppy.sh/users/')) return null;
  const usersMatch = profileLink.match(/osu\.ppy\.sh\/users\/(\d+)/);
  if (usersMatch) return { userId: usersMatch[1], username: null, profileLink };
  const usernameMatch = profileLink.match(/osu\.ppy\.sh\/users\/([^\/\?#]+)/);
  if (usernameMatch && !/^\d+$/.test(usernameMatch[1])) {
    return { userId: null, username: usernameMatch[1], profileLink };
  }
  return null;
}
