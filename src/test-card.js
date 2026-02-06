/**
 * One-off script to verify card rendering and font registration.
 * Run: node src/test-card.js
 * Then open test-card-output.png and check that stat values look semibold (600) vs labels (400).
 */
import fs from 'fs';
import { drawChallengeCard } from './card.js';

const mockScore = (overrides = {}) => ({
  pp: 123.4,
  accuracy: 0.9876,
  max_combo: 456,
  score: 1234567,
  statistics: { count_300: 200, count_100: 10, count_50: 2, count_miss: 0 },
  mods: [{ acronym: 'HDHR' }],
  ...overrides,
});

async function main() {
  const leftUser = { avatarBuffer: null, username: 'LeftPlayer' };
  const rightUser = { avatarBuffer: null, username: 'RightPlayer' };
  const championScore = mockScore({ pp: 150, score: 1500000 });
  const responderScore = mockScore({ pp: 120, score: 1200000 });
  const statWinners = ['left', 'right', 'left', 'right', 'tie', 'left', 'right', 'left', 'right'];
  const loserSide = 'right';

  const pngBuffer = await drawChallengeCard(
    leftUser,
    rightUser,
    championScore,
    responderScore,
    statWinners,
    loserSide
  );
  const outPath = 'test-card-output.png';
  fs.writeFileSync(outPath, pngBuffer);
  console.log(`[test-card] Wrote ${outPath} — open it to verify stat values use semibold (600) font.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
