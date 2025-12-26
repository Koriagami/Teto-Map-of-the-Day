/**
 * OSU! API v2 Client
 * Handles OAuth2 authentication and API requests
 */

const API_BASE_URL = 'https://osu.ppy.sh/api/v2';
const TOKEN_URL = 'https://osu.ppy.sh/oauth/token';

let accessToken = null;
let tokenExpiry = null;

/**
 * Get OAuth2 access token using client credentials flow
 */
async function getAccessToken() {
  // Check if we have a valid token
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const clientId = process.env.OSU_CLIENT_ID;
  const clientSecret = process.env.OSU_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('OSU_CLIENT_ID and OSU_CLIENT_SECRET must be set in .env file');
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'public',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    accessToken = data.access_token;
    // Set expiry to 5 minutes before actual expiry for safety
    tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

    return accessToken;
  } catch (error) {
    console.error('Error getting OSU API access token:', error);
    throw error;
  }
}

/**
 * Make an authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorText;
    try {
      errorText = await response.text();
      // Try to parse as JSON for better error messages
      try {
        const errorJson = JSON.parse(errorText);
        errorText = JSON.stringify(errorJson, null, 2);
      } catch {
        // Not JSON, use as-is
      }
    } catch {
      errorText = `Status: ${response.status}`;
    }
    throw new Error(`OSU API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Extract beatmap ID from osu.ppy.sh URL
 * Supports formats like:
 * - https://osu.ppy.sh/beatmapsets/123#osu/456
 * - https://osu.ppy.sh/beatmaps/456
 * - https://osu.ppy.sh/b/456
 */
function extractBeatmapId(url) {
  // Try beatmapsets format: /beatmapsets/{set_id}#{mode}/{beatmap_id}
  const beatmapsetsMatch = url.match(/beatmapsets\/\d+#\w+\/(\d+)/);
  if (beatmapsetsMatch) {
    return beatmapsetsMatch[1];
  }

  // Try /beatmaps/{beatmap_id}
  const beatmapsMatch = url.match(/beatmaps\/(\d+)/);
  if (beatmapsMatch) {
    return beatmapsMatch[1];
  }

  // Try /b/{beatmap_id}
  const bMatch = url.match(/\/b\/(\d+)/);
  if (bMatch) {
    return bMatch[1];
  }

  // If URL is just a number, assume it's a beatmap ID
  const numberMatch = url.match(/^(\d+)$/);
  if (numberMatch) {
    return numberMatch[1];
  }

  return null;
}

/**
 * Get beatmap information
 */
async function getBeatmap(beatmapId) {
  return apiRequest(`/beatmaps/${beatmapId}`);
}

/**
 * Get beatmap scores/leaderboard
 * @param {string} beatmapId - The beatmap ID
 * @param {object} options - Optional parameters (mode, mods, etc.)
 */
async function getBeatmapScores(beatmapId, options = {}) {
  const params = new URLSearchParams();
  
  if (options.mode) params.append('mode', options.mode);
  if (options.mods) params.append('mods', options.mods);
  if (options.limit) params.append('limit', options.limit.toString());

  const queryString = params.toString();
  const endpoint = `/beatmaps/${beatmapId}/scores${queryString ? `?${queryString}` : ''}`;

  return apiRequest(endpoint);
}

/**
 * Get user's recent scores
 * @param {string} userId - OSU user ID
 * @param {object} options - Optional parameters (mode, limit, etc.)
 */
async function getUserRecentScores(userId, options = {}) {
  const params = new URLSearchParams();
  
  if (options.mode) params.append('mode', options.mode);
  if (options.limit) params.append('limit', (options.limit || 1).toString());
  if (options.include_fails !== undefined) params.append('include_fails', options.include_fails ? '1' : '0');

  const queryString = params.toString();
  const endpoint = `/users/${userId}/scores/recent${queryString ? `?${queryString}` : ''}`;

  return apiRequest(endpoint);
}

/**
 * Get user's best score for a specific beatmap
 * @param {string} beatmapId - The beatmap ID
 * @param {string} userId - OSU user ID
 * @param {object} options - Optional parameters (mode, mods, etc.)
 * @returns {Promise<object|null>} User's best score for the beatmap, or null if no score exists
 */
async function getUserBeatmapScore(beatmapId, userId, options = {}) {
  const params = new URLSearchParams();
  
  if (options.mode) params.append('mode', options.mode);
  if (options.mods) params.append('mods', options.mods);

  const queryString = params.toString();
  // This endpoint returns the user's best score for the specified beatmap
  // Ensure userId is a string (OSU API accepts both string and number)
  const userIdStr = String(userId);
  const endpoint = `/beatmaps/${beatmapId}/scores/users/${userIdStr}${queryString ? `?${queryString}` : ''}`;

  try {
    const response = await apiRequest(endpoint);
    
    // Log the raw response for debugging (only in development)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEBUG] getUserBeatmapScore response for beatmap ${beatmapId}, user ${userIdStr}:`, JSON.stringify(response, null, 2));
    }
    
    // The OSU API v2 returns the score object directly
    // But it might be wrapped in a 'score' property in some cases
    if (response && typeof response === 'object') {
      // If response has a 'score' property, unwrap it
      if (response.score && typeof response.score === 'object') {
        return response.score;
      }
      // If response is already a score object, return it
      return response;
    }
    return response;
  } catch (error) {
    // Log the full error for debugging
    console.error(`[ERROR] getUserBeatmapScore failed for beatmap ${beatmapId}, user ${userIdStr}:`, {
      message: error.message,
      endpoint: endpoint,
      beatmapId: beatmapId,
      userId: userIdStr
    });
    
    // If user has no score for this beatmap, API returns 404
    // Also check for various 404 error formats
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('404') || 
        errorMessage.includes('not found') || 
        errorMessage.includes('no score') ||
        errorMessage.includes('user has no score')) {
      return null;
    }
    throw error;
  }
}

/**
 * Get user information by user ID or username
 * @param {string} user - OSU user ID (number) or username (string)
 * @param {object} options - Optional parameters (mode, key, etc.)
 * @returns {Promise<object|null>} User object or null if user doesn't exist
 */
async function getUser(user, options = {}) {
  const params = new URLSearchParams();
  
  if (options.mode) params.append('mode', options.mode);
  if (options.key) params.append('key', options.key);

  const queryString = params.toString();
  const endpoint = `/users/${user}${queryString ? `?${queryString}` : ''}`;

  try {
    return await apiRequest(endpoint);
  } catch (error) {
    // If user doesn't exist, API returns 404
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export { extractBeatmapId, getBeatmap, getBeatmapScores, getUserRecentScores, getUserBeatmapScore, getUser };

