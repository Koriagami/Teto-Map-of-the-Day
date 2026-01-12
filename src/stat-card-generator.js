import { createCanvas, loadImage } from 'canvas';
import { AttachmentBuilder } from 'discord.js';

/**
 * Check if canvas is available (system dependencies installed)
 * @returns {boolean} True if canvas is available
 */
function checkCanvasAvailability() {
  try {
    const testCanvas = createCanvas(1, 1);
    testCanvas.getContext('2d');
    return true;
  } catch (error) {
    console.error('Canvas is not available:', error.message);
    console.error('Ensure canvas system dependencies (Cairo, Pango, libpng, jpeg, giflib, librsvg) are installed.');
    return false;
  }
}

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

// Timeout and retry settings
const AVATAR_LOAD_TIMEOUT = 5000; // 5 seconds
const AVATAR_MAX_RETRIES = 2;
const IMAGE_QUALITY = 0.85; // JPEG quality (0-1), balance between size and quality

// Layout constants
const AVATAR_SIZE = 120; // Increased from 80
const AVATAR_Y = 20;
const AVATAR_LEFT_X = 50;
const AVATAR_RIGHT_X = CANVAS_WIDTH - 50 - AVATAR_SIZE;
const MAP_NAME_Y = 160; // Adjusted for larger avatars
const TABLE_START_Y = 220; // Adjusted for larger avatars
const ROW_HEIGHT = 60;
const LABEL_COLUMN_X = CANVAS_WIDTH / 2 - 120;
const LEFT_COLUMN_X = 50;
const RIGHT_COLUMN_X = CANVAS_WIDTH / 2 + 50;
const BAR_WIDTH = 250;
const BAR_HEIGHT = 20;
const BAR_Y_OFFSET = 25;

// Vertical divider margins
const DIVIDER_TOP_MARGIN = 150; // Margin from top
const DIVIDER_BOTTOM_MARGIN = 50; // Margin from bottom
const STAT_LABEL_DIVIDER_TOP_MARGIN = 200; // Stat label divider starts lower
const STAT_LABEL_DIVIDER_BOTTOM_MARGIN = 100; // Stat label divider ends higher

/**
 * Timeout wrapper for async operations
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} errorMessage - Error message if timeout
 * @returns {Promise} Promise that rejects on timeout
 */
function withTimeout(promise, timeoutMs, errorMessage = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

/**
 * Load image with timeout and retry logic
 * @param {string} url - Image URL
 * @param {number} retries - Number of retries remaining
 * @returns {Promise} Loaded image
 */
async function loadImageWithTimeout(url, retries = AVATAR_MAX_RETRIES) {
  try {
    return await withTimeout(
      loadImage(url),
      AVATAR_LOAD_TIMEOUT,
      `Avatar load timeout after ${AVATAR_LOAD_TIMEOUT}ms`
    );
  } catch (error) {
    if (retries > 0) {
      console.warn(`Avatar load failed, retrying (${retries} retries left):`, error.message);
      // Wait a bit before retry
      await new Promise(resolve => setTimeout(resolve, 500));
      return loadImageWithTimeout(url, retries - 1);
    }
    throw error;
  }
}

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
 * @throws {Error} If canvas operations fail
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
  // Check if canvas is available
  if (!checkCanvasAvailability()) {
    throw new Error('Canvas is not available. Ensure canvas system dependencies (Cairo, Pango, libpng, jpeg, giflib, librsvg) are installed on the server.');
  }
  
  let canvas;
  let ctx;
  
  try {
    // Validate inputs
    if (!challengerScore || !responderScore) {
      throw new Error('Invalid score data: challengerScore and responderScore are required');
    }
    
    // Create canvas with error handling
    try {
      canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx = canvas.getContext('2d');
    } catch (error) {
      throw new Error(`Failed to create canvas: ${error.message}. Ensure canvas system dependencies (Cairo, Pango) are installed.`);
    }

    // 1. Draw black background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 2. Draw vertical dividers
    drawDividers(ctx);

    // 3. Draw header (profile pictures + map name) with error handling
    try {
      await drawHeader(ctx, challengerAvatarUrl, responderAvatarUrl, mapName, difficulty, responderWon);
    } catch (error) {
      console.error('Error drawing header:', error);
      // Continue with placeholder avatars
    }

    // 4. Extract and prepare stats
    const stats = extractStats(challengerScore, responderScore);

    // 5. Draw stat comparison table
    try {
      drawStatTable(ctx, stats, challengerUsername, responderUsername, responderWon);
    } catch (error) {
      console.error('Error drawing stat table:', error);
      throw new Error(`Failed to draw stat table: ${error.message}`);
    }

    // 6. Export to buffer with optimization
    let buffer;
    try {
      // Use JPEG for smaller file size, fallback to PNG if JPEG fails
      try {
        buffer = canvas.toBuffer('image/jpeg', { quality: IMAGE_QUALITY });
        return new AttachmentBuilder(buffer, { name: 'challenge-stats.jpg' });
      } catch (jpegError) {
        console.warn('JPEG export failed, falling back to PNG:', jpegError.message);
        buffer = canvas.toBuffer('image/png');
        return new AttachmentBuilder(buffer, { name: 'challenge-stats.png' });
      }
    } catch (error) {
      throw new Error(`Failed to export canvas to image: ${error.message}`);
    }
  } catch (error) {
    console.error('Error in generateChallengeStatCard:', error);
    throw error;
  }
}

/**
 * Draw vertical dividers on the canvas with margins
 */
function drawDividers(ctx) {
  ctx.strokeStyle = COLORS.divider;
  
  // Main center divider (thicker, with top and bottom margins)
  ctx.lineWidth = 3; // Made thicker for visibility
  ctx.beginPath();
  ctx.moveTo(CANVAS_WIDTH / 2, DIVIDER_TOP_MARGIN);
  ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - DIVIDER_BOTTOM_MARGIN);
  ctx.stroke();

  // Stat labels divider (thinner, shorter, offset left - more obvious length difference)
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LABEL_COLUMN_X, STAT_LABEL_DIVIDER_TOP_MARGIN);
  ctx.lineTo(LABEL_COLUMN_X, CANVAS_HEIGHT - STAT_LABEL_DIVIDER_BOTTOM_MARGIN);
  ctx.stroke();
}

/**
 * Draw header section with profile pictures, map name, and crown
 */
async function drawHeader(ctx, avatar1Url, avatar2Url, mapName, difficulty, responderWon) {
  // Draw challenger avatar (left) with timeout handling
  if (avatar1Url) {
    try {
      const avatar1 = await loadImageWithTimeout(avatar1Url);
      drawCircularImage(ctx, avatar1, AVATAR_LEFT_X, AVATAR_Y, AVATAR_SIZE);
    } catch (error) {
      console.warn(`Failed to load challenger avatar after retries: ${error.message}. Using placeholder.`);
      drawPlaceholderAvatar(ctx, AVATAR_LEFT_X, AVATAR_Y, AVATAR_SIZE, COLORS.challenger);
    }
  } else {
    drawPlaceholderAvatar(ctx, AVATAR_LEFT_X, AVATAR_Y, AVATAR_SIZE, COLORS.challenger);
  }

  // Draw map name (centered, orange) with truncation if too long
  ctx.fillStyle = COLORS.mapName;
  // Use system font that's guaranteed to be available on Linux
  ctx.font = 'bold 28px Sans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let mapText = `${mapName} [${difficulty}]`;
  // Truncate if too long (max ~50 chars to fit canvas width)
  const maxMapTextWidth = CANVAS_WIDTH - 100;
  const metrics = ctx.measureText(mapText);
  if (metrics.width > maxMapTextWidth) {
    // Truncate and add ellipsis
    while (ctx.measureText(mapText + '...').width > maxMapTextWidth && mapText.length > 0) {
      mapText = mapText.slice(0, -1);
    }
    mapText = mapText + '...';
  }
  ctx.fillText(mapText, CANVAS_WIDTH / 2, MAP_NAME_Y);

  // Draw responder avatar (right) with timeout handling
  if (avatar2Url) {
    try {
      const avatar2 = await loadImageWithTimeout(avatar2Url);
      drawCircularImage(ctx, avatar2, AVATAR_RIGHT_X, AVATAR_Y, AVATAR_SIZE);
    } catch (error) {
      console.warn(`Failed to load responder avatar after retries: ${error.message}. Using placeholder.`);
      drawPlaceholderAvatar(ctx, AVATAR_RIGHT_X, AVATAR_Y, AVATAR_SIZE, COLORS.responder);
    }
  } else {
    drawPlaceholderAvatar(ctx, AVATAR_RIGHT_X, AVATAR_Y, AVATAR_SIZE, COLORS.responder);
  }

  // Draw crown icon for winner (right side, next to responder avatar if they won)
  try {
    if (responderWon) {
      drawCrownIcon(ctx, AVATAR_RIGHT_X + AVATAR_SIZE + 10, AVATAR_Y + AVATAR_SIZE / 2);
    } else {
      // Challenger won, draw crown on left side
      drawCrownIcon(ctx, AVATAR_LEFT_X + AVATAR_SIZE + 10, AVATAR_Y + AVATAR_SIZE / 2);
    }
  } catch (error) {
    console.warn('Error drawing crown icon:', error);
    // Non-critical, continue without crown
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
    // Use system font that's guaranteed to be available on Linux
    ctx.font = '20px Sans';
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
  // Use system font that's guaranteed to be available on Linux
  ctx.font = 'bold 18px Sans';
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
