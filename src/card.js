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

/** Card dimensions (match teto_bg.png: 2000×2480) */
export const CARD_WIDTH = 2000;
export const CARD_HEIGHT = 2480;

/** Default background fill when no image is found (dark gray) */
const FALLBACK_BG_COLOR = 'rgb(26, 26, 26)';

/** Background image path: assets/card/backgrounds/teto_bg.png */
const BACKGROUND_IMAGE_PATH = path.join(process.cwd(), 'assets', 'card', 'backgrounds', 'teto_bg.png');

/** Placeholder when no profile picture: assets/card/pfp/no_pfp.png */
const PLACEHOLDER_PFP_PATH = path.join(process.cwd(), 'assets', 'card', 'pfp', 'no_pfp.png');

/** Winner avatar decoration: left winner → teto_l_cropped.png, right winner → teto_r_cropped.png */
const DECORATION_WINNER_LEFT_PATH = path.join(process.cwd(), 'assets', 'card', 'decorations', 'teto_l_cropped.png');
const DECORATION_WINNER_RIGHT_PATH = path.join(process.cwd(), 'assets', 'card', 'decorations', 'teto_r_cropped.png');

/**
 * Load the background image (teto_bg.png only).
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

/**
 * Load winner avatar decoration image.
 * @param {'left'|'right'} winnerSide - which side won
 * @returns {Promise<import('@napi-rs/canvas').Image | null>}
 */
async function loadWinnerOverlay(winnerSide) {
  const overlayPath = winnerSide === 'left' ? DECORATION_WINNER_LEFT_PATH : DECORATION_WINNER_RIGHT_PATH;
  if (!fs.existsSync(overlayPath)) return null;
  try {
    return await loadImage(overlayPath);
  } catch (e) {
    console.warn('[card] Failed to load winner overlay:', e.message);
    return null;
  }
}

/** Scale factors from original 600×800 design to 2000×2480 */
const SCALE_X = CARD_WIDTH / 600;
const SCALE_Y = CARD_HEIGHT / 800;

/** Shift entire card UI down by 10% of card height */
const UI_TOP_OFFSET = Math.round(CARD_HEIGHT * 0.1);

/** Avatar size (diameter when drawn as circle) at center top */
const AVATAR_SIZE = Math.round(120 * SCALE_Y);
const AVATAR_BORDER_WIDTH = Math.round(3 * SCALE_Y);
const AVATAR_BORDER_COLOR = 'rgb(166, 196, 162)';
/** Half-transparent grey mask over loser avatar */
const LOSER_MASK_COLOR = 'rgba(25, 23, 23, 0.82)';
/** Winning stat row: draw winning side line thicker (values are not highlighted) */
const WINNING_STAT_LINE_WIDTH_MULTIPLIER = 1.6;
const AVATAR_TOP_MARGIN = Math.round(20 * SCALE_Y);
/** Horizontal offset of each avatar center from the card center (left = center - offset, right = center + offset) */
const AVATAR_OFFSET_FROM_CENTER = Math.round(130 * SCALE_X);
const USERNAME_MARGIN_TOP = Math.round(8 * SCALE_Y);
const USERNAME_FONT_SIZE = Math.round(24 * SCALE_Y);

/** Stats section under username — base values; scaled at draw time to fill card height */
const STATS_MARGIN_TOP = Math.round(28 * SCALE_Y); // space from player names to first stat title
const STAT_ROW_HEIGHT_BASE = Math.round(34 * SCALE_Y);
const STAT_LINE_Y_OFFSET_BASE = 12 * SCALE_Y;
const STAT_NAME_ABOVE_LINE_BASE = 10 * SCALE_Y; // space between stat title and line
const STAT_LABEL_FONT_SIZE_BASE = Math.round(16 * SCALE_Y);
const STAT_VALUE_FONT_SIZE_BASE = Math.round(14 * SCALE_Y);
const STAT_VALUE_MARGIN_BASE = Math.round(6 * SCALE_X);
const STAT_LINE_STROKE_WIDTH_BASE = 6 * SCALE_Y;
const STATS_BOTTOM_MARGIN = Math.round(24 * SCALE_Y);
/** Mods text: horizontal offset from center (closer than bar ends) */
const MODS_TEXT_OFFSET_FROM_CENTER = Math.round(90 * SCALE_X);
const CENTER_X = CARD_WIDTH / 2;
/** Colors: score1 line (left), score2 line (right) — darker blue for contrast, neon-style */
const STAT_LINE_COLOR_LEFT = 'rgb(175, 241, 238)';
const STAT_LINE_COLOR_RIGHT = 'rgb(241, 79, 198)';
/** Outline for stat names (dark grey) and stat values (white-ish grey) */
const STAT_VALUE_OUTLINE_WIDTH = Math.max(2, Math.round(2 * SCALE_Y));
const STAT_LABEL_OUTLINE_COLOR = 'rgb(45, 45, 45)';   // stat names
const STAT_VALUE_OUTLINE_COLOR = 'rgb(224, 224, 224)';   // stat values

/** Maximum length (px) of a stat line when it represents 100% of the scale */
export const MAX_STAT_LINE_LENGTH = Math.round(200 * SCALE_X);

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
 * Load avatar image from buffer or placeholder.
 * @param {Buffer | null} avatarBuffer
 * @returns {Promise<import('@napi-rs/canvas').Image | null>}
 */
async function loadAvatarImage(avatarBuffer) {
  if (avatarBuffer && avatarBuffer.length > 0) {
    try {
      return await loadImage(avatarBuffer);
    } catch (e) {
      console.warn('[card] Failed to load avatar buffer:', e.message);
    }
  }
  if (fs.existsSync(PLACEHOLDER_PFP_PATH)) {
    try {
      return await loadImage(PLACEHOLDER_PFP_PATH);
    } catch (e) {
      console.warn('[card] Failed to load placeholder pfp:', e.message);
    }
  }
  return null;
}

/**
 * Draw challenge/compare card (internal). Left = champion, right = responder.
 * @param {object} leftUser - { avatarBuffer: Buffer|null, username: string }
 * @param {object} rightUser - { avatarBuffer: Buffer|null, username: string }
 * @param {[object, object]} scores - [championScore, responderScore]
 * @param {('left'|'right'|'tie')[]} statWinners - per-row winner (length 9), optional; default all 'tie'
 * @param {'left'|'right'|null} loserSide - which avatar gets grey mask (null = none)
 * @returns {Promise<Buffer>} PNG buffer
 */
async function drawCardInternal(leftUser, rightUser, scores, statWinners = null, loserSide = null) {
  const winners = statWinners || STAT_DEFS.map(() => 'tie');
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  const bgImage = await loadBackgroundImage();
  if (bgImage) {
    ctx.drawImage(bgImage, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  } else {
    ctx.fillStyle = FALLBACK_BG_COLOR;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  const avatarY = AVATAR_TOP_MARGIN + UI_TOP_OFFSET;
  const avatarCenterLeft = CENTER_X - AVATAR_OFFSET_FROM_CENTER;
  const avatarCenterRight = CENTER_X + AVATAR_OFFSET_FROM_CENTER;
  const avatarXLeft = avatarCenterLeft - AVATAR_SIZE / 2;
  const avatarXRight = avatarCenterRight - AVATAR_SIZE / 2;
  const avatarCx = (x) => x + AVATAR_SIZE / 2;
  const avatarCy = () => avatarY + AVATAR_SIZE / 2;
  const avatarRadius = AVATAR_SIZE / 2;

  const leftAvatarImage = await loadAvatarImage(leftUser?.avatarBuffer ?? null);
  const rightAvatarImage = await loadAvatarImage(rightUser?.avatarBuffer ?? null);

  const drawOneAvatar = (img, x) => {
    if (!img) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCx(x), avatarCy(), avatarRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, x, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCx(x), avatarCy(), avatarRadius, 0, Math.PI * 2);
    ctx.strokeStyle = AVATAR_BORDER_COLOR;
    ctx.lineWidth = AVATAR_BORDER_WIDTH;
    ctx.stroke();
    ctx.restore();
  };
  drawOneAvatar(leftAvatarImage, avatarXLeft);
  drawOneAvatar(rightAvatarImage, avatarXRight);

  if (loserSide === 'left') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCx(avatarXLeft), avatarCy(), avatarRadius, 0, Math.PI * 2);
    ctx.fillStyle = LOSER_MASK_COLOR;
    ctx.fill();
    ctx.restore();
  } else if (loserSide === 'right') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCx(avatarXRight), avatarCy(), avatarRadius, 0, Math.PI * 2);
    ctx.fillStyle = LOSER_MASK_COLOR;
    ctx.fill();
    ctx.restore();
  }

  let statsStartY = avatarY + AVATAR_SIZE + USERNAME_MARGIN_TOP;
  const leftName = (leftUser?.username && String(leftUser.username).trim()) ? String(leftUser.username).trim() : null;
  const rightName = (rightUser?.username && String(rightUser.username).trim()) ? String(rightUser.username).trim() : null;
  ctx.save();
  ctx.font = `bold ${USERNAME_FONT_SIZE}px ${CARD_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(2, Math.round(3 * SCALE_Y));
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgb(255, 255, 255)';
  const nameY = statsStartY;
  if (leftName) {
    ctx.strokeText(leftName, avatarCenterLeft, nameY);
    ctx.fillText(leftName, avatarCenterLeft, nameY);
  }
  if (rightName) {
    ctx.strokeText(rightName, avatarCenterRight, nameY);
    ctx.fillText(rightName, avatarCenterRight, nameY);
  }
  ctx.restore();
  statsStartY += USERNAME_FONT_SIZE;
  statsStartY += STATS_MARGIN_TOP;

  const play1 = scores?.[0];
  const play2 = scores?.[1];
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
      const winner = winners[i] || 'tie';
      const leftWins = winner === 'left';
      const rightWins = winner === 'right';

      ctx.font = `${labelFontSize}px ${CARD_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const labelY = lineY - nameAboveLine;
      ctx.strokeStyle = STAT_LABEL_OUTLINE_COLOR;
      ctx.lineWidth = STAT_VALUE_OUTLINE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.strokeText(stat.label, CENTER_X, labelY);
      ctx.fillStyle = 'rgb(174, 231, 144)';
      ctx.fillText(stat.label, CENTER_X, labelY);

      if (stat.textOnly) {
        const textLeft = stat.getText(play1);
        const textRight = stat.getText(play2);
        const textXLeft = CENTER_X - MODS_TEXT_OFFSET_FROM_CENTER;
        const textXRight = CENTER_X + MODS_TEXT_OFFSET_FROM_CENTER;
        ctx.font = `bold ${valueFontSize}px ${CARD_FONT_FAMILY}`;
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
        const leftLineWidth = leftWins ? lineStrokeWidth * WINNING_STAT_LINE_WIDTH_MULTIPLIER : lineStrokeWidth;
        const rightLineWidth = rightWins ? lineStrokeWidth * WINNING_STAT_LINE_WIDTH_MULTIPLIER : lineStrokeWidth;

        ctx.strokeStyle = STAT_LINE_COLOR_LEFT;
        ctx.lineWidth = leftLineWidth;
        ctx.beginPath();
        ctx.moveTo(CENTER_X, lineY);
        ctx.lineTo(CENTER_X - length1, lineY);
        ctx.stroke();

        ctx.strokeStyle = STAT_LINE_COLOR_RIGHT;
        ctx.lineWidth = rightLineWidth;
        ctx.beginPath();
        ctx.moveTo(CENTER_X, lineY);
        ctx.lineTo(CENTER_X + length2, lineY);
        ctx.stroke();

        ctx.font = `bold ${valueFontSize}px ${CARD_FONT_FAMILY}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = STAT_LINE_COLOR_LEFT;
        ctx.textAlign = 'right';
        const val1X = CENTER_X - length1 - valueMargin;
        ctx.fillText(stat.format(value1), val1X, lineY);

        ctx.fillStyle = STAT_LINE_COLOR_RIGHT;
        ctx.textAlign = 'left';
        const val2X = CENTER_X + length2 + valueMargin;
        ctx.fillText(stat.format(value2), val2X, lineY);
      }
    }
    ctx.restore();
  }

  // Top layer: winner decoration over the winning avatar
  if (loserSide === 'left' || loserSide === 'right') {
    const winnerSide = loserSide === 'left' ? 'right' : 'left';
    const overlayImage = await loadWinnerOverlay(winnerSide);
    if (overlayImage) {
      const decoSize = AVATAR_SIZE * 0.75; // larger decoration (teto_*_cropped.png)
      const winnerCenterX = winnerSide === 'left' ? avatarCenterLeft : avatarCenterRight;
      const decoX = winnerCenterX - decoSize / 2;
      const decoY = avatarY - decoSize / 2;
      ctx.drawImage(overlayImage, decoX, decoY, decoSize, decoSize);
    }
  }

  return await canvas.encode('png');
}

/**
 * Draw the card prototype: background + avatar + username + stat lines (2 most recent plays).
 * Single user on both sides (for /teto test card).
 */
export async function drawCardPrototype(avatarBuffer = null, username = '', recentScores = null) {
  const user = { avatarBuffer, username };
  return drawCardInternal(user, user, recentScores || [], null, null);
}

/**
 * Draw challenge response card: champion (left) vs responder (right), with stat winners and loser mask.
 * @param {object} leftUser - { avatarBuffer: Buffer|null, username: string } (champion)
 * @param {object} rightUser - { avatarBuffer: Buffer|null, username: string } (responder)
 * @param {object} championScore - score object for left stats
 * @param {object} responderScore - score object for right stats
 * @param {('left'|'right'|'tie')[]} statWinners - per-row winner (length 9)
 * @param {'left'|'right'} loserSide - which avatar gets grey mask (left = champion lost, right = responder lost)
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function drawChallengeCard(leftUser, rightUser, championScore, responderScore, statWinners, loserSide) {
  return drawCardInternal(leftUser, rightUser, [championScore, responderScore], statWinners, loserSide);
}
