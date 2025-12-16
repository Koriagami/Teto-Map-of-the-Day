# Teto Map of the Day - Discord Bot

**Purpose:** Allow Discord users to submit their favourite osu! maps in a moderated environment.

#### NOTE: This tool was "vibe coded" on the spot out of curiosity. All the code in this repo is 98% AI generated.

## Features
- `/teto setup` (admin only) — set the operating channel (where submissions are posted)
- `/teto map submit <maplink> [recommended_mod_1..5]` — submit a map (one submission per user per calendar date)
- `/test <maplink> [limit]` — test OSU! API - get leaderboard scores for a beatmap
- Bot posts submission in the operating channel and adds 👍 and 👎 reactions
- If 👎 reaches 4 (including bot), the post is edited to the "meh" message
- Persistence via JSON files
- Automatic daily reset at midnight (server time)
- OSU! API v2 integration for fetching beatmap leaderboards

## Setup

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
OSU_CLIENT_ID=your_osu_oauth_client_id
OSU_CLIENT_SECRET=your_osu_oauth_client_secret
```

### Getting OSU! API Credentials

1. Log in to your osu! account
2. Go to [Account Settings](https://osu.ppy.sh/home/account/edit)
3. Navigate to the [OAuth section](https://osu.ppy.sh/home/account/edit#oauth)
4. Click "New OAuth Application"
5. Fill in the application details (name, description, etc.)
6. Set the redirect URL (can be `http://localhost` for testing)
7. Copy the **Client ID** and **Client Secret** to your `.env` file

### Installation

1. `npm install`
2. `npm run deploy-commands` (registers slash commands)
3. `npm start`

## Files
- `src/index.js` — main bot code
- `src/commands.js` — slash command definitions
- `src/deploy-commands.js` — helper to deploy commands
- `src/osu-api.js` — OSU! API v2 client with OAuth2 authentication
- `teto_config.json` — created automatically to store operating channel per guild
- `teto_submissions.json` — created automatically to store last submission dates per user/guild

## Notes
- This project uses Node ESM modules.
- For production, replace JSON persistence with a proper database.
