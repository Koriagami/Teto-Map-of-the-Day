import { createCanvas, loadImage } from 'canvas';
import { AttachmentBuilder } from 'discord.js';

// Colors
const COLORS = {
  background: '#000000',
  divider: '#FFFFFF',
  challenger: '#FFD700', // Yellow/Gold
  responder: '#4169E1',  // Blue
  mapName: '#FF8C00',    // Orange
  label: '#FFFFFF'        // White
};

// Canvas dimensions
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

// Layout constants
const AVATAR_SIZE = 80;
const AVATAR_Y = 20;
const AVATAR_LEFT_X = 50;
const AVATAR_RIGHT_X = CANVAS_WIDTH - 50 - AVATAR_SIZE;
const MAP_NAME_Y = 120;
const TABLE_START_Y = 180;
const ROW_HEIGHT = 60;
const LABEL_COLUMN_X = CANVAS_WIDTH / 2 - 120;
const LEFT_COLUMN_X = 50;
const RIGHT_COLUMN_X = CANVAS_WIDTH / 2 + 50;
const BAR_WIDTH = 250;
const BAR_HEIGHT = 20;
const BAR_Y_OFFSET = 25;

/**
 * Generate a stat card image comparing two players' scores
 * @param {Object} challengerScore - Score object from osu! API
 * @param {Object} responderScore - Score object from osu! API
 * @param {string} challengerUsername - Username of challenger
 * @param {string} responderUsername - Username of responder
 * @param {string} mapName - Map title
 * @param {string} difficulty - Difficulty name
 * @param {string} challengerAvatarUrl - Discord avatar URL for challenger
 * @param {string} responderAvatarUrl - Discord avatar URL for responder
 * @param {boolean} responderWon - Whether responder won the challenge
 * @returns {Promise<AttachmentBuilder>} Discord attachment with the stat card image
 */
export async function generateChallengeStatCard(
  challengerScore,
  responderScore,
  challengerUsername,
  responderUsername,
  mapName,
  difficulty,
  challengerAvatarUrl,
  responderAvatarUrl,
  responderWon
) {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // 1. Draw black background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 2. Draw vertical dividers
  drawDividers(ctx);

  // 3. Draw header (profile pictures + map name)
  await drawHeader(ctx, challengerAvatarUrl, responderAvatarUrl, mapName, difficulty, responderWon);

  // 4. Extract and prepare stats
  const stats = extractStats(challengerScore, responderScore);

  // 5. Draw stat comparison table
  drawStatTable(ctx, stats, challengerUsername, responderUsername, responderWon);

  // 6. Export to buffer and create attachment
  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'challenge-stats.png' });
}

/**
 * Draw vertical dividers on the canvas
 */
function drawDividers(ctx) {
  ctx.strokeStyle = COLORS.divider;
  
  // Main center divider (thicker)
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CANVAS_WIDTH / 2, 0);
  ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
  ctx.stroke();

  // Stat labels divider (thinner, offset left)
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LABEL_COLUMN_X, 0);
  ctx.lineTo(LABEL_COLUMN_X, CANVAS_HEIGHT);
  ctx.stroke();
}

/**
 * Draw header section with profile pictures, map name, and crown
 */
async function drawHeader(ctx, avatar1Url, avatar2Url, mapName, difficulty, responderWon) {
  // Draw challenger avatar (left)
  if (avatar1Url) {
    try {
      const avatar1 = await loadImage(avatar1Url);
      drawCircularImage(ctx, avatar1, AVATAR_LEFT_X, AVATAR_Y, AVATAR_SIZE);
    } catch (error) {
      console.error('Error loading challenger avatar:', error);
      drawPlaceholderAvatar(ctx, AVATAR_LEFT_X, AVATAR_Y, AVATAR_SIZE, COLORS.challenger);
    }
  } else {
    drawPlaceholderAvatar(ctx, AVATAR_LEFT_X, AVATAR_Y, AVATAR_SIZE, COLORS.challenger);
  }

  // Draw map name (centered, orange)
  ctx.fillStyle = COLORS.mapName;
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mapText = `${mapName} [${difficulty}]`;
  ctx.fillText(mapText, CANVAS_WIDTH / 2, MAP_NAME_Y);

  // Draw responder avatar (right)
  if (avatar2Url) {
    try {
      const avatar2 = await loadImage(avatar2Url);
      drawCircularImage(ctx, avatar2, AVATAR_RIGHT_X, AVATAR_Y, AVATAR_SIZE);
    } catch (error) {
      console.error('Error loading responder avatar:', error);
      drawPlaceholderAvatar(ctx, AVATAR_RIGHT_X, AVATAR_Y, AVATAR_SIZE, COLORS.responder);
    }
  } else {
    drawPlaceholderAvatar(ctx, AVATAR_RIGHT_X, AVATAR_Y, AVATAR_SIZE, COLORS.responder);
  }

  // Draw crown icon for winner (right side, next to responder avatar if they won)
  if (responderWon) {
    drawCrownIcon(ctx, AVATAR_RIGHT_X + AVATAR_SIZE + 10, AVATAR_Y + AVATAR_SIZE / 2);
  } else {
    // Challenger won, draw crown on left side
    drawCrownIcon(ctx, AVATAR_LEFT_X + AVATAR_SIZE + 10, AVATAR_Y + AVATAR_SIZE / 2);
  }
}

/**
 * Draw a circular image with white border
 */
function drawCircularImage(ctx, image, x, y, size) {
  ctx.save();
  
  // Create circular clipping path
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  
  // Draw image
  ctx.drawImage(image, x, y, size, size);
  
  ctx.restore();
  
  // Draw white border
  ctx.strokeStyle = COLORS.divider;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Draw placeholder avatar (colored circle with initial)
 */
function drawPlaceholderAvatar(ctx, x, y, size, color) {
  // Draw colored circle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw white border
  ctx.strokeStyle = COLORS.divider;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/**
 * Draw crown icon (simple geometric shape)
 */
function drawCrownIcon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#FFD700'; // Gold
  ctx.strokeStyle = '#FFA500'; // Orange border
  ctx.lineWidth = 2;
  
  // Draw crown shape (simplified)
  ctx.beginPath();
  // Base
  ctx.moveTo(x - 15, y + 5);
  ctx.lineTo(x + 15, y + 5);
  ctx.lineTo(x + 12, y - 5);
  ctx.lineTo(x + 5, y - 10);
  ctx.lineTo(x, y - 5);
  ctx.lineTo(x - 5, y - 10);
  ctx.lineTo(x - 12, y - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  ctx.restore();
}

/**
 * Extract all stats from score objects
 */
function extractStats(challengerScore, responderScore) {
  return {
    pp: {
      challenger: challengerScore.pp || 0,
      responder: responderScore.pp || 0,
      format: (v) => v.toFixed(2),
      higherIsBetter: true
    },
    accuracy: {
      challenger: (challengerScore.accuracy || 0) * 100,
      responder: (responderScore.accuracy || 0) * 100,
      format: (v) => `${v.toFixed(2)}%`,
      higherIsBetter: true
    },
    max_combo: {
      challenger: challengerScore.max_combo || 0,
      responder: responderScore.max_combo || 0,
      format: (v) => v.toString(),
      higherIsBetter: true
    },
    score: {
      challenger: challengerScore.score || 0,
      responder: responderScore.score || 0,
      format: (v) => v.toLocaleString(),
      higherIsBetter: true
    },
    misses: {
      challenger: challengerScore.statistics?.count_miss || 0,
      responder: responderScore.statistics?.count_miss || 0,
      format: (v) => v.toString(),
      higherIsBetter: false // Lower is better
    },
    count_300: {
      challenger: challengerScore.statistics?.count_300 || 0,
      responder: responderScore.statistics?.count_300 || 0,
      format: (v) => v.toString(),
      higherIsBetter: true
    },
    count_100: {
      challenger: challengerScore.statistics?.count_100 || 0,
      responder: responderScore.statistics?.count_100 || 0,
      format: (v) => v.toString(),
      higherIsBetter: true
    },
    count_50: {
      challenger: challengerScore.statistics?.count_50 || 0,
      responder: responderScore.statistics?.count_50 || 0,
      format: (v) => v.toString(),
      higherIsBetter: true
    },
    mods: {
      challenger: formatModsFromScore(challengerScore),
      responder: formatModsFromScore(responderScore),
      format: (v) => v || 'No mods',
      higherIsBetter: null // Not comparable
    }
  };
}

/**
 * Format mods from score object (helper function)
 */
function formatModsFromScore(score) {
  if (!score.mods || !Array.isArray(score.mods) || score.mods.length === 0) {
    return 'No mods';
  }
  
  const modNames = score.mods.map(mod => {
    if (typeof mod === 'string') return mod;
    if (typeof mod === 'object' && mod.acronym) return mod.acronym;
    return '';
  }).filter(Boolean);
  
  return modNames.length > 0 ? modNames.join(', ') : 'No mods';
}

/**
 * Draw the stat comparison table
 */
function drawStatTable(ctx, stats, challengerUsername, responderUsername, responderWon) {
  const statOrder = ['pp', 'accuracy', 'max_combo', 'score', 'misses', 'count_300', 'count_100', 'count_50', 'mods'];
  const statLabels = {
    pp: 'PP',
    accuracy: 'Accuracy',
    max_combo: 'Max Combo',
    score: 'Score',
    misses: 'Misses',
    count_300: '300s',
    count_100: '100s',
    count_50: '50s',
    mods: 'Mods'
  };

  statOrder.forEach((statKey, index) => {
    const y = TABLE_START_Y + (index * ROW_HEIGHT);
    const stat = stats[statKey];
    const label = statLabels[statKey];

    // Draw stat label (center, white)
    ctx.fillStyle = COLORS.label;
    ctx.font = '20px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, LABEL_COLUMN_X, y + ROW_HEIGHT / 2);

    // Determine winners for this stat (if comparable)
    let challengerWinsStat = false;
    let responderWinsStat = false;
    
    if (stat.higherIsBetter === true) {
      challengerWinsStat = stat.challenger > stat.responder;
      responderWinsStat = stat.responder > stat.challenger;
    } else if (stat.higherIsBetter === false) {
      challengerWinsStat = stat.challenger < stat.responder;
      responderWinsStat = stat.responder < stat.challenger;
    }
    // mods: not comparable, no winner

    // Draw challenger stat (left, yellow)
    drawStatRow(
      ctx,
      LEFT_COLUMN_X,
      y,
      stat.challenger,
      stat.format,
      COLORS.challenger,
      challengerWinsStat,
      BAR_WIDTH,
      stat // Pass stat object for bar calculation (contains challenger, responder, higherIsBetter)
    );

    // Draw responder stat (right, blue)
    drawStatRow(
      ctx,
      RIGHT_COLUMN_X,
      y,
      stat.responder,
      stat.format,
      COLORS.responder,
      responderWinsStat,
      BAR_WIDTH,
      stat // Pass stat object for bar calculation
    );
  });
}

/**
 * Draw a single stat row (value, trophy, bar chart)
 */
function drawStatRow(ctx, x, y, value, formatFn, color, isWinner, barWidth, stat) {
  const textY = y + ROW_HEIGHT / 2;
  
  // Format and draw value text
  ctx.fillStyle = color;
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const formattedValue = formatFn(value);
  const textMetrics = ctx.measureText(formattedValue);
  ctx.fillText(formattedValue, x, textY);

  // Draw trophy icon if winner
  if (isWinner) {
    const trophyX = x + textMetrics.width + 10;
    drawTrophyIcon(ctx, trophyX, textY);
  }

  // Draw bar chart (only if stat is comparable)
  if (stat && stat.higherIsBetter !== null) {
    const barX = x;
    const barY = y + BAR_Y_OFFSET;
    
    // Calculate bar length (normalize to max value between both players)
    const maxValue = Math.max(stat.challenger, stat.responder);
    const minValue = Math.min(stat.challenger, stat.responder);
    
    let barLength;
    if (maxValue === 0) {
      barLength = 0;
    } else if (stat.higherIsBetter === false) {
      // For "lower is better" stats (misses), invert the calculation
      // Higher value = shorter bar
      const range = maxValue - minValue;
      if (range === 0) {
        barLength = barWidth;
      } else {
        barLength = ((maxValue - value) / range) * barWidth;
      }
    } else {
      // Normal: higher value = longer bar
      barLength = (value / maxValue) * barWidth;
    }

    // Draw bar background (outline)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barWidth, BAR_HEIGHT);

    // Draw filled bar
    if (barLength > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(barX, barY, barLength, BAR_HEIGHT);
    }
  }
}

/**
 * Draw trophy icon (simple geometric shape)
 */
function drawTrophyIcon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#FFD700'; // Gold
  ctx.strokeStyle = '#FFA500'; // Orange border
  ctx.lineWidth = 1.5;
  
  // Draw trophy shape (simplified)
  ctx.beginPath();
  // Base
  ctx.moveTo(x - 8, y + 8);
  ctx.lineTo(x + 8, y + 8);
  ctx.lineTo(x + 6, y + 4);
  ctx.lineTo(x - 6, y + 4);
  ctx.closePath();
  // Cup
  ctx.moveTo(x - 6, y + 4);
  ctx.lineTo(x - 4, y - 6);
  ctx.lineTo(x - 2, y - 8);
  ctx.lineTo(x + 2, y - 8);
  ctx.lineTo(x + 4, y - 6);
  ctx.lineTo(x + 6, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  ctx.restore();
}
