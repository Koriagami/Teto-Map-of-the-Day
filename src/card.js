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
 * Draw the card prototype: background (image or solid) + optional avatar at center top + username + a line.
 * @param {Buffer | null} [avatarBuffer] - Optional osu! profile picture image bytes
 * @param {string} [username] - Optional osu! username to draw under the avatar
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function drawCardPrototype(avatarBuffer = null, username = '') {
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
  if (username && username.length > 0) {
    ctx.save();
    ctx.font = `bold ${USERNAME_FONT_SIZE}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const usernameY = avatarY + AVATAR_SIZE + USERNAME_MARGIN_TOP;
    ctx.fillText(username, CARD_WIDTH / 2, usernameY);
    ctx.restore();
  }

  // Draw a simple line (diagonal for visibility)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(50, 80);
  ctx.lineTo(CARD_WIDTH - 50, CARD_HEIGHT - 80);
  ctx.stroke();

  return await canvas.encode('png');
}
