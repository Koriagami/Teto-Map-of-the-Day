/**
 * Mock data for test commands
 * This file contains all mock data used in test command functions
 * Modify these values to change test data without touching the test functions
 */

// Base mock score data (used for trs, tc, rsci commands)
export const mockScore = {
  score: 1234567,
  pp: 123.45,
  accuracy: 0.95,
  max_combo: 500,
  rank: 'A',
  mods: [{ acronym: 'HD' }, { acronym: 'HR' }],
  statistics: {
    count_300: 200,
    count_100: 50,
    count_50: 10,
    count_miss: 5
  },
  beatmap: {
    id: 12345,
    version: 'Test Difficulty',
    cs: 4.2,
    ar: 9.5,
    bpm: 180,
    accuracy: 8.0,
    drain: 6.5
  },
  beatmapset: {
    id: 6789,
    title: 'Test Map Title',
    title_unicode: 'Test Map Title'
  }
};

// Mock score with single mod (used for tc command)
export const mockScoreSingleMod = {
  score: 1234567,
  pp: 123.45,
  accuracy: 0.95,
  max_combo: 500,
  rank: 'A',
  mods: [{ acronym: 'HD' }],
  statistics: {
    count_300: 200,
    count_100: 50,
    count_50: 10,
    count_miss: 5
  },
  beatmap: {
    id: 12345,
    version: 'Test Difficulty',
    cs: 4.2,
    ar: 9.5,
    bpm: 180,
    accuracy: 8.0,
    drain: 6.5
  },
  beatmapset: {
    id: 6789,
    title: 'Test Map Title',
    title_unicode: 'Test Map Title'
  }
};

// Helper: create multiple mock scores with varying stats (for tc command)
export function createMockScores(baseScore, count = 3) {
  const scores = [];
  for (let i = 0; i < count; i++) {
    scores.push({
      ...baseScore,
      score: baseScore.score - (i * 50000), // Decreasing scores
      pp: baseScore.pp - (i * 5), // Decreasing PP
      accuracy: baseScore.accuracy - (i * 0.02), // Decreasing accuracy
      max_combo: baseScore.max_combo - (i * 20), // Decreasing combo
      rank: i === 0 ? 'A' : i === 1 ? 'B' : 'C', // Different ranks
      statistics: {
        count_300: baseScore.statistics.count_300 - (i * 10),
        count_100: baseScore.statistics.count_100 + (i * 5),
        count_50: baseScore.statistics.count_50 + (i * 2),
        count_miss: baseScore.statistics.count_miss + (i * 1)
      }
    });
  }
  return scores;
}

// Mock challenger score (used for rscr command)
export const mockChallengerScore = {
  score: 1234567,
  pp: 123.45,
  accuracy: 0.95,
  max_combo: 500,
  rank: 'A',
  mods: [{ acronym: 'HD' }],
  statistics: {
    count_300: 200,
    count_100: 50,
    count_50: 10,
    count_miss: 5
  },
  beatmap: {
    id: 12345,
    version: 'Test Difficulty'
  },
  beatmapset: {
    id: 6789,
    title: 'Test Map Title'
  },
  user: {
    username: 'ChallengerUser'
  }
};

// Mock responder score (used for rscr command)
// This is based on challenger score but with better stats
export function createMockResponderScore(challengerScore, responderUsername) {
  return {
    ...challengerScore,
    score: challengerScore.score + 10000,
    pp: challengerScore.pp + 10,
    accuracy: 0.96,
    max_combo: 520,
    user: {
      username: responderUsername
    }
  };
}

// Mock beatmap data (used for motd command)
export const mockBeatmap = {
  id: 12345,
  version: 'Test Difficulty',
  beatmapset_id: 6789,
  beatmapset: {
    id: 6789,
    title: 'Test Map Title',
    title_unicode: 'Test Map Title'
  }
};

// Mock recommended mods (used for motd command)
export const mockMods = ['HD', 'HR'];

// Default difficulty name fallback
export const defaultDifficulty = 'Test Difficulty';

// Mock "2 most recent plays" for card stats (different values for comparison)
export const mockRecentPlay1 = {
  score: 36589080,
  pp: 0,
  accuracy: 0.9635,
  max_combo: 1085,
};
export const mockRecentPlay2 = {
  score: 21480640,
  pp: 146.5,
  accuracy: 0.9637,
  max_combo: 666,
};
