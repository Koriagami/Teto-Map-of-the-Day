/**
 * Verify "best score by flat value" logic: same as commandHandlers when responding with link.
 * User 13770689, beatmap 4362117. Expected best score value: 6280162.
 * Run: node src/test-best-score.js
 * Requires .env with OSU_CLIENT_ID and OSU_CLIENT_SECRET.
 */
import 'dotenv/config';
import { getUserBeatmapScoresAll } from './osu-api.js';
import { extractScoreValue, isValidScore } from './scoreHelpers.js';

const BEATMAP_ID = '4362117';
const USER_ID = '13770689';
const EXPECTED_SCORE_VALUE = 6280162;

async function main() {
  // Same logic as commandHandlers.js "with link": getUserBeatmapScoresAll, pick best by flat score only
  let apiScores = [];
  try {
    apiScores = (await getUserBeatmapScoresAll(BEATMAP_ID, USER_ID)) || [];
  } catch (e) {
    console.error('getUserBeatmapScoresAll failed:', e?.message);
    process.exit(1);
  }

  let bestScore = null;
  if (apiScores.length > 0) {
    // Same as handler: prefer isValidScore; fallback to any score with numeric value so we don't drop API responses that omit beatmap.version
    const valid =
      apiScores.filter((s) => s && isValidScore(s)).length > 0
        ? apiScores.filter((s) => s && isValidScore(s))
        : apiScores.filter((s) => s && typeof extractScoreValue(s) === 'number');
    if (valid.length > 0) {
      bestScore = valid.reduce((best, s) => {
        const v = Number(extractScoreValue(s)) || 0;
        const bestV = Number(extractScoreValue(best)) || 0;
        return v > bestV ? s : best;
      });
    }
  }

  const value = bestScore ? Number(extractScoreValue(bestScore)) || 0 : null;
  const ok = value === EXPECTED_SCORE_VALUE;

  console.log('API scores count:', apiScores.length);
  console.log('Best by flat score value:', value, '(expected', EXPECTED_SCORE_VALUE + ')');
  console.log('PASS:', ok ? 'YES' : 'NO');

  if (!ok) {
    console.error('Fix verification failed: got value', value, 'expected', EXPECTED_SCORE_VALUE);
    process.exit(1);
  }
  console.log('Verification passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
