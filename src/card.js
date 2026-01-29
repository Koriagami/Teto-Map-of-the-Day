/**
 * Card image drawing (Skia via @napi-rs/canvas).
 * Prototype: background image + a line drawn on it.
 * Text requires a registered font; we register a system/bundled font so labels and values render.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Font family used for all card text. Must be a registered font — "sans-serif" often doesn't render in headless/Linux (e.g. Railway). */
let CARD_FONT_FAMILY = 'CardFont';

/** Bundled font: @fontsource/source-sans-3 (woff2). Works on Railway and everywhere. */
const BUNDLED_FONT_PATH = path.join(__dirname, '..', 'node_modules', '@fontsource', 'source-sans-3', 'files', 'source-sans-3-latin-400-normal.woff2');

function registerCardFont() {
  if (GlobalFonts.has('CardFont')) return;
  const candidates = [
    BUNDLED_FONT_PATH,
    path.join(process.cwd(), 'node_modules', '@fontsource', 'source-sans-3', 'files', 'source-sans-3-latin-400-normal.woff2'),
  ];
  const fontsDir = path.join(process.cwd(), 'assets', 'card', 'fonts');
  if (fs.existsSync(fontsDir)) {
    try {
      const files = fs.readdirSync(fontsDir).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
      files.forEach((f) => candidates.push(path.join(fontsDir, f)));
    } catch (_) {}
  }
  if (process.platform === 'win32') {
    const sysRoot = process.env.SYSTEMROOT || process.env.WINDIR || 'C:\\Windows';
    candidates.push(path.join(sysRoot, 'Fonts', 'arial.ttf'), path.join(sysRoot, 'Fonts', 'Arial.ttf'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Library/Fonts/Arial.ttf', path.join(process.env.HOME || '', 'Library', 'Fonts', 'Arial.ttf'));
  } else {
    candidates.push('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  }
  for (const fontPath of candidates) {
    if (fs.existsSync(fontPath)) {
      try {
        if (GlobalFonts.registerFromPath(fontPath, 'CardFont')) {
          return;
        }
      } catch (e) {
        console.warn('[card] Failed to register font from', fontPath, e.message);
      }
    }
  }
  console.warn('[card] No font registered — card text may not render. Install @fontsource/source-sans-3 or add a .ttf to assets/card/fonts/');
  CARD_FONT_FAMILY = 'sans-serif';
}

registerCardFont();

/** Card dimensions */
export const CARD_WIDTH = 600;
export const CARD_HEIGHT = 800;

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

/** Avatar size (diameter when drawn as circle) at center top */
const AVATAR_SIZE = 100;
const AVATAR_TOP_MARGIN = 20;
/** Horizontal offset of each avatar center from the card center (left = center - offset, right = center + offset) */
const AVATAR_OFFSET_FROM_CENTER = 130;
const USERNAME_MARGIN_TOP = 8;
const USERNAME_FONT_SIZE = 18;

/** Stats section under username — base values; scaled at draw time to fill card height */
const STATS_MARGIN_TOP = 16;
const STAT_ROW_HEIGHT_BASE = 34;
const STAT_LINE_Y_OFFSET_BASE = 12;
const STAT_NAME_ABOVE_LINE_BASE = 10; // space between stat title and line
const STAT_LABEL_FONT_SIZE_BASE = 16;
const STAT_VALUE_FONT_SIZE_BASE = 14;
const STAT_VALUE_MARGIN_BASE = 6;
const STAT_LINE_STROKE_WIDTH_BASE = 6;
const STATS_BOTTOM_MARGIN = 24;
/** Mods text: horizontal offset from center (closer than bar ends) */
const MODS_TEXT_OFFSET_FROM_CENTER = 90;
const CENTER_X = CARD_WIDTH / 2;
/** Colors: score1 line (left), score2 line (right) — darker blue for contrast, neon-style */
const STAT_LINE_COLOR_LEFT = '#0284c7';
const STAT_LINE_COLOR_RIGHT = '#f59e0b';
const STAT_LINE_GLOW_BLUR = 8; // blur for neon glow effect

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

  let length1 = Math.min((value1 * maxLength) / scaleValue, maxLength);
  let length2 = Math.min((value2 * maxLength) / scaleValue, maxLength);

  // If both lengths are below half of max, double them so the bars are more visible
  const halfMax = maxLength / 2;
  if (length1 < halfMax && length2 < halfMax) {
    length1 *= 2;
    length2 *= 2;
  }

  return { length1, length2, scaleValue };
}

/**
 * Format mods from play/score object (text only; no numeric value for bars).
 * Play object may have mods: array of { acronym } or string.
 */
function formatMods(play) {
  if (!play || typeof play !== 'object') return 'No mods';
  if (Array.isArray(play.mods) && play.mods.length > 0) {
    const acronyms = play.mods
      .map((m) => (typeof m === 'object' && m.acronym ? m.acronym : typeof m === 'string' ? m : null))
      .filter(Boolean);
    return acronyms.length > 0 ? acronyms.join(', ') : 'No mods';
  }
  if (typeof play.mods_string === 'string' && play.mods_string.length > 0) return play.mods_string;
  if (typeof play.mods === 'string' && play.mods.length > 0) return play.mods;
  return 'No mods';
}

/**
 * Stat definitions: Mods first (text only), then PP, Accuracy, Max Combo, Score, Misses, 300s, 100s, 50s.
 * Play object: score, pp, accuracy (0–1), max_combo, statistics: { count_300, count_100, count_50, count_miss }, mods.
 */
const STAT_DEFS = [
  {
    label: 'Mods',
    textOnly: true,
    getText: (p) => formatMods(p),
  },
  { label: 'PP', getValue: (p) => p.pp ?? 0, format: (v) => String(Number(v).toFixed(1)) },
  {
    label: 'Accuracy %',
    getValue: (p) => (p.accuracy != null ? p.accuracy * 100 : 0),
    format: (v) => `${Number(v).toFixed(2)}%`,
  },
  { label: 'Max combo', getValue: (p) => p.max_combo ?? 0, format: (v) => String(Math.round(v)) },
  {
    label: 'Score',
    getValue: (p) => p.score ?? 0,
    format: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Number(v).toLocaleString()),
  },
  {
    label: 'Misses',
    getValue: (p) => p.statistics?.count_miss ?? 0,
    format: (v) => String(Math.round(v)),
  },
  {
    label: '300s',
    getValue: (p) => p.statistics?.count_300 ?? 0,
    format: (v) => String(Math.round(v)),
  },
  {
    label: '100s',
    getValue: (p) => p.statistics?.count_100 ?? 0,
    format: (v) => String(Math.round(v)),
  },
  {
    label: '50s',
    getValue: (p) => p.statistics?.count_50 ?? 0,
    format: (v) => String(Math.round(v)),
  },
];

/**
 * Draw the card prototype: background + avatar + username + stat lines (2 most recent plays).
 * @param {Buffer | null} [avatarBuffer] - Optional osu! profile picture image bytes
 * @param {string} [username] - Optional osu! username to draw under the avatar
 * @param {[object, object]} [recentScores] - Optional [play1, play2] for stats (score, pp, accuracy, max_combo, statistics, mods)
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
  const avatarY = AVATAR_TOP_MARGIN;
  const avatarCenterLeft = CENTER_X - AVATAR_OFFSET_FROM_CENTER;
  const avatarCenterRight = CENTER_X + AVATAR_OFFSET_FROM_CENTER;
  const avatarXLeft = avatarCenterLeft - AVATAR_SIZE / 2;
  const avatarXRight = avatarCenterRight - AVATAR_SIZE / 2;

  if (avatarImage) {
    const drawAvatarAt = (x) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImage, x, avatarY, AVATAR_SIZE, AVATAR_SIZE);
      ctx.restore();
    };
    drawAvatarAt(avatarXLeft);
    drawAvatarAt(avatarXRight);
  }

  // Osu! username under each profile picture — same vertical position for both
  let statsStartY = avatarY + AVATAR_SIZE + USERNAME_MARGIN_TOP;
  const displayName = (username && String(username).trim()) ? String(username).trim() : null;
  if (displayName) {
    ctx.save();
    ctx.font = `bold ${USERNAME_FONT_SIZE}px ${CARD_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    const nameY = statsStartY;
    ctx.strokeText(displayName, avatarCenterLeft, nameY);
    ctx.fillText(displayName, avatarCenterLeft, nameY);
    ctx.strokeText(displayName, avatarCenterRight, nameY);
    ctx.fillText(displayName, avatarCenterRight, nameY);
    ctx.restore();
    statsStartY += USERNAME_FONT_SIZE;
  }
  statsStartY += STATS_MARGIN_TOP;

  // Stat lines: fill bottom of card; scale row height, fonts, and line thickness proportionally
  const play1 = recentScores?.[0];
  const play2 = recentScores?.[1];
  if (play1 && play2) {
    const statsAreaHeight = CARD_HEIGHT - statsStartY - STATS_BOTTOM_MARGIN;
    const rowHeight = statsAreaHeight / STAT_DEFS.length;
    const scale = rowHeight / STAT_ROW_HEIGHT_BASE;
    const labelFontSize = Math.round(STAT_LABEL_FONT_SIZE_BASE * scale);
    const valueFontSize = Math.round(STAT_VALUE_FONT_SIZE_BASE * scale);
    const lineStrokeWidth = Math.max(2, Math.round(STAT_LINE_STROKE_WIDTH_BASE * scale));
    const lineYOffset = STAT_LINE_Y_OFFSET_BASE * scale;
    const nameAboveLine = STAT_NAME_ABOVE_LINE_BASE * scale;
    const valueMargin = STAT_VALUE_MARGIN_BASE * scale;

    ctx.save();
    for (let i = 0; i < STAT_DEFS.length; i++) {
      const stat = STAT_DEFS[i];
      const rowY = statsStartY + i * rowHeight;
      const lineY = rowY + lineYOffset;

      ctx.font = `${labelFontSize}px ${CARD_FONT_FAMILY}`;
      ctx.fillStyle = '#e5e5e5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(stat.label, CENTER_X, lineY - nameAboveLine);

      if (stat.textOnly) {
        // Mods: text only, placed closer to center
        const textLeft = stat.getText(play1);
        const textRight = stat.getText(play2);
        const textXLeft = CENTER_X - MODS_TEXT_OFFSET_FROM_CENTER;
        const textXRight = CENTER_X + MODS_TEXT_OFFSET_FROM_CENTER;
        ctx.font = `${valueFontSize}px ${CARD_FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = STAT_LINE_COLOR_LEFT;
        ctx.textAlign = 'right';
        ctx.fillText(textLeft.length > 12 ? textLeft.slice(0, 10) + '..' : textLeft, textXLeft, lineY);
        ctx.fillStyle = STAT_LINE_COLOR_RIGHT;
        ctx.textAlign = 'left';
        ctx.fillText(textRight.length > 12 ? textRight.slice(0, 10) + '..' : textRight, textXRight, lineY);
      } else {
        const value1 = stat.getValue(play1);
        const value2 = stat.getValue(play2);
        const { length1, length2 } = calculateStatScale(value1, value2);

        ctx.lineWidth = lineStrokeWidth;
        ctx.strokeStyle = STAT_LINE_COLOR_LEFT;
        ctx.shadowColor = STAT_LINE_COLOR_LEFT;
        ctx.shadowBlur = STAT_LINE_GLOW_BLUR;
        ctx.beginPath();
        ctx.moveTo(CENTER_X, lineY);
        ctx.lineTo(CENTER_X - length1, lineY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = STAT_LINE_COLOR_RIGHT;
        ctx.shadowColor = STAT_LINE_COLOR_RIGHT;
        ctx.shadowBlur = STAT_LINE_GLOW_BLUR;
        ctx.beginPath();
        ctx.moveTo(CENTER_X, lineY);
        ctx.lineTo(CENTER_X + length2, lineY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.font = `${valueFontSize}px ${CARD_FONT_FAMILY}`;
        ctx.fillStyle = STAT_LINE_COLOR_LEFT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(stat.format(value1), CENTER_X - length1 - valueMargin, lineY);

        ctx.fillStyle = STAT_LINE_COLOR_RIGHT;
        ctx.textAlign = 'left';
        ctx.fillText(stat.format(value2), CENTER_X + length2 + valueMargin, lineY);
      }
    }
    ctx.restore();
  }

  return await canvas.encode('png');
}
