/**
 * Card image drawing (Skia via @napi-rs/canvas).
 * Prototype: background image + a line drawn on it.
 */

import path from 'path';
import fs from 'fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

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
const STAT_ROW_HEIGHT = 28;
const STAT_LINE_Y_OFFSET = 10; // vertical offset of line within row (below label)
const STAT_LABEL_FONT_SIZE = 12;
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
 * Stat definitions for comparison: label + getter from a play object.
 * Play object: { score, pp, accuracy (0–1), max_combo }
 */
const STAT_DEFS = [
  { label: 'Score', getValue: (p) => p.score ?? 0 },
  { label: 'Accuracy %', getValue: (p) => (p.accuracy != null ? p.accuracy * 100 : 0) },
  { label: 'PP', getValue: (p) => p.pp ?? 0 },
  { label: 'Max combo', getValue: (p) => p.max_combo ?? 0 },
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

  // Osu! username under the profile picture
  let statsStartY = avatarY + AVATAR_SIZE + USERNAME_MARGIN_TOP;
  if (username && username.length > 0) {
    ctx.save();
    ctx.font = `bold ${USERNAME_FONT_SIZE}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(username, CARD_WIDTH / 2, statsStartY);
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
      const { label, getValue } = STAT_DEFS[i];
      const value1 = getValue(play1);
      const value2 = getValue(play2);
      const { length1, length2 } = calculateStatScale(value1, value2);

      const rowY = statsStartY + i * STAT_ROW_HEIGHT;
      const lineY = rowY + STAT_LINE_Y_OFFSET;

      // Label (left of center)
      ctx.font = `${STAT_LABEL_FONT_SIZE}px sans-serif`;
      ctx.fillStyle = '#e5e5e5';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, CENTER_X - 12, lineY);

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
    }
    ctx.restore();
  }

  return await canvas.encode('png');
}
