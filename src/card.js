/**
 * Card image drawing (Skia via @napi-rs/canvas).
 * Prototype: background image + a line drawn on it.
 * Text requires a registered font; we register a system/bundled font so labels and values render.
 */

import path from 'path';
import fs from 'fs';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

/** Font family used for all card text. @napi-rs/canvas may not resolve "sans-serif" on all systems, so we register a concrete font. */
let CARD_FONT_FAMILY = 'sans-serif';

function registerCardFont() {
  if (GlobalFonts.has('CardFont')) return;
  const candidates = [];
  if (process.platform === 'win32') {
    const sysRoot = process.env.SYSTEMROOT || process.env.WINDIR || 'C:\\Windows';
    candidates.push(path.join(sysRoot, 'Fonts', 'arial.ttf'));
    candidates.push(path.join(sysRoot, 'Fonts', 'Arial.ttf'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Library/Fonts/Arial.ttf');
    candidates.push(path.join(process.env.HOME || '', 'Library', 'Fonts', 'Arial.ttf'));
  } else {
    candidates.push(path.join(process.cwd(), 'assets', 'card', 'fonts', 'LiberationSans-Regular.ttf'));
    candidates.push('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf');
  }
  const fontsDir = path.join(process.cwd(), 'assets', 'card', 'fonts');
  if (fs.existsSync(fontsDir)) {
    try {
      const files = fs.readdirSync(fontsDir).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
      files.forEach((f) => candidates.unshift(path.join(fontsDir, f)));
    } catch (_) {}
  }
  for (const fontPath of candidates) {
    if (fs.existsSync(fontPath)) {
      try {
        if (GlobalFonts.registerFromPath(fontPath, 'CardFont')) {
          CARD_FONT_FAMILY = 'CardFont';
          return;
        }
      } catch (e) {
        console.warn('[card] Failed to register font from', fontPath, e.message);
      }
    }
  }
}

registerCardFont();

/** Card dimensions */
export const CARD_WIDTH = 650;
export const CARD_HEIGHT = 600;

/** Default background fill when no image is found (dark gray) */
const FALLBACK_BG_COLOR = '#1a1a1a';

/** Background image path: assets/card/backgrounds/bubly_bg.png */
const BACKGROUND_IMAGE_PATH = path.join(process.cwd(), 'assets', 'card', 'backgrounds', 'bubly_bg.png');

/** Placeholder when no profile picture: assets/card/pfp/no_pfp.png */
const PLACEHOLDER_PFP_PATH = path.join(process.cwd(), 'assets', 'card', 'pfp', 'no_pfp.png');

/**
 * Load the background image (bubly_bg.png only).
 * @returns {Promise<import('@napi-rs/canvas').Image | null>}
 */
async function loadBackgroundImage() {
  if (!fs.existsSync(BACKGROUND_IMAGE_PATH)) {
    return null;
  }
  try {
    return await loadImage(BACKGROUND_IMAGE_PATH);
  } catch (e) {
    console.warn('[card] Failed to load background:', e.message);
    return null;
  }
}

/** Avatar size (diameter when drawn as circle) at center top — 25% bigger than original 80px */
const AVATAR_SIZE = 100;
const AVATAR_TOP_MARGIN = 20;
const USERNAME_MARGIN_TOP = 8;
const USERNAME_FONT_SIZE = 18;

/** Stats section under username */
const STATS_MARGIN_TOP = 16;
const STAT_ROW_HEIGHT = 34; // enough for label + line + value (increased for larger font)
const STAT_LINE_Y_OFFSET = 12; // vertical offset of line within row (below stat name)
const STAT_NAME_ABOVE_LINE = 4; // stat name sits this many px above the line
const STAT_LABEL_FONT_SIZE = 16; // larger so stat names are visible
const STAT_VALUE_FONT_SIZE = 14; // larger so compared values are visible
const STAT_TEXT_OUTLINE_WIDTH = 2; // stroke so text is readable on any background
const STAT_VALUE_MARGIN = 6; // gap between line end and value text
const STAT_LINE_STROKE_WIDTH = 6;
const CENTER_X = CARD_WIDTH / 2;
/** Colors: score1 line (left), score2 line (right) */
const STAT_LINE_COLOR_LEFT = '#7dd3fc';
const STAT_LINE_COLOR_RIGHT = '#fbbf24';

/** Maximum length (px) of a stat line when it represents 100% of the scale */
export const MAX_STAT_LINE_LENGTH = 200;

/**
 * Calculate proportional line lengths for two stat values so they share a common scale.
 * Picks the bigger value (first if equal), sets scale to one magnitude above that value
 * (scale = 100% = max length), then returns both lengths in proportion.
 * @param {number} value1 - First stat value
 * @param {number} value2 - Second stat value
 * @param {number} [maxLength=MAX_STAT_LINE_LENGTH] - Max line length in px (default 200)
 * @returns {{ length1: number, length2: number, scaleValue: number }}
 * @example
 */
export function calculateStatScale(value1, value2, maxLength = MAX_STAT_LINE_LENGTH) {
  const bigger = value1 >= value2 ? value1 : value2;

  let scaleValue;
  if (bigger <= 0 || !Number.isFinite(bigger)) {
    scaleValue = 100;
  } else {
    const exponent = Math.floor(Math.log10(bigger));
    scaleValue = Math.pow(10, exponent + 1);
  }

  const length1 = Math.min((value1 * maxLength) / scaleValue, maxLength);
  const length2 = Math.min((value2 * maxLength) / scaleValue, maxLength);

  return { length1, length2, scaleValue };
}

/**
 * Stat definitions: label + getter + formatter for display.
 * Play object: { score, pp, accuracy (0–1), max_combo }
 */
const STAT_DEFS = [
  {
    label: 'Score',
    getValue: (p) => p.score ?? 0,
    format: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Number(v).toLocaleString()),
  },
  {
    label: 'Accuracy %',
    getValue: (p) => (p.accuracy != null ? p.accuracy * 100 : 0),
    format: (v) => `${Number(v).toFixed(2)}%`,
  },
  {
    label: 'PP',
    getValue: (p) => p.pp ?? 0,
    format: (v) => String(Number(v).toFixed(1)),
  },
  {
    label: 'Max combo',
    getValue: (p) => p.max_combo ?? 0,
    format: (v) => String(Math.round(v)),
  },
];

/**
 * Draw the card prototype: background + avatar + username + stat lines (2 most recent plays).
 * @param {Buffer | null} [avatarBuffer] - Optional osu! profile picture image bytes
 * @param {string} [username] - Optional osu! username to draw under the avatar
 * @param {[object, object]} [recentScores] - Optional [play1, play2] for stats (each: score, pp, accuracy, max_combo)
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function drawCardPrototype(avatarBuffer = null, username = '', recentScores = null) {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  const bgImage = await loadBackgroundImage();
  if (bgImage) {
    ctx.drawImage(bgImage, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  } else {
    ctx.fillStyle = FALLBACK_BG_COLOR;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  // Center top: osu! profile picture or placeholder (circular)
  let avatarImage = null;
  if (avatarBuffer && avatarBuffer.length > 0) {
    try {
      avatarImage = await loadImage(avatarBuffer);
    } catch (e) {
      console.warn('[card] Failed to load avatar buffer:', e.message);
    }
  }
  if (!avatarImage && fs.existsSync(PLACEHOLDER_PFP_PATH)) {
    try {
      avatarImage = await loadImage(PLACEHOLDER_PFP_PATH);
    } catch (e) {
      console.warn('[card] Failed to load placeholder pfp:', e.message);
    }
  }
  const avatarX = (CARD_WIDTH - AVATAR_SIZE) / 2;
  const avatarY = AVATAR_TOP_MARGIN;
  if (avatarImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImage, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  }

  // Osu! username under the profile picture — always show a label when we have one; make it visible on any background
  let statsStartY = avatarY + AVATAR_SIZE + USERNAME_MARGIN_TOP;
  const displayName = (username && String(username).trim()) ? String(username).trim() : null;
  if (displayName) {
    ctx.save();
    ctx.font = `bold ${USERNAME_FONT_SIZE}px ${CARD_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const nameX = CARD_WIDTH / 2;
    const nameY = statsStartY;
    // Dark outline so white text is readable on light backgrounds (e.g. bubly_bg)
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(displayName, nameX, nameY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(displayName, nameX, nameY);
    ctx.restore();
    statsStartY += USERNAME_FONT_SIZE;
  }
  statsStartY += STATS_MARGIN_TOP;

  // Stat lines: vertical center axis as start; score1 left, score2 right
  const play1 = recentScores?.[0];
  const play2 = recentScores?.[1];
  if (play1 && play2) {
    ctx.save();
    for (let i = 0; i < STAT_DEFS.length; i++) {
      const { label, getValue, format } = STAT_DEFS[i];
      const value1 = getValue(play1);
      const value2 = getValue(play2);
      const { length1, length2 } = calculateStatScale(value1, value2);

      const rowY = statsStartY + i * STAT_ROW_HEIGHT;
      const lineY = rowY + STAT_LINE_Y_OFFSET;

      // Stat name at center, slightly above the lines (outline so visible on any background)
      ctx.font = `${STAT_LABEL_FONT_SIZE}px ${CARD_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const labelY = lineY - STAT_NAME_ABOVE_LINE;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = STAT_TEXT_OUTLINE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.strokeText(label, CENTER_X, labelY);
      ctx.fillStyle = '#e5e5e5';
      ctx.fillText(label, CENTER_X, labelY);

      // Score1 line: from center going left
      ctx.strokeStyle = STAT_LINE_COLOR_LEFT;
      ctx.lineWidth = STAT_LINE_STROKE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(CENTER_X, lineY);
      ctx.lineTo(CENTER_X - length1, lineY);
      ctx.stroke();

      // Score2 line: from center going right
      ctx.strokeStyle = STAT_LINE_COLOR_RIGHT;
      ctx.beginPath();
      ctx.moveTo(CENTER_X, lineY);
      ctx.lineTo(CENTER_X + length2, lineY);
      ctx.stroke();

      // Value1 at end of left line (left of the line) — outline for visibility
      ctx.font = `${STAT_VALUE_FONT_SIZE}px ${CARD_FONT_FAMILY}`;
      const val1X = CENTER_X - length1 - STAT_VALUE_MARGIN;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = STAT_TEXT_OUTLINE_WIDTH;
      ctx.strokeText(format(value1), val1X, lineY);
      ctx.fillStyle = STAT_LINE_COLOR_LEFT;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(format(value1), val1X, lineY);

      // Value2 at end of right line (right of the line) — outline for visibility
      const val2X = CENTER_X + length2 + STAT_VALUE_MARGIN;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(format(value2), val2X, lineY);
      ctx.fillStyle = STAT_LINE_COLOR_RIGHT;
      ctx.textAlign = 'left';
      ctx.fillText(format(value2), val2X, lineY);
    }
    ctx.restore();
  }

  return await canvas.encode('png');
}
