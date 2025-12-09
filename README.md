# Teto Map of the Day - Discord Bot

**Purpose:** Allow Discord users to submit their favourite osu! maps in a moderated environment.

#### NOTE: This tool was "vibe coded" on the spot out of curiosity. All the code in this repo is 98% AI generated.

## Features
- `/teto setup` (admin only) — set the operating channel (where submissions are posted)
- `/teto map submit <maplink> [recommended_mod_1..5]` — submit a map (one submission per user per calendar date)
- Bot posts submission in the operating channel and adds 👍 and 👎 reactions
- If 👎 reaches 4 (including bot), the post is edited to the "meh" message
- Persistence via JSON files
- Automatic daily reset at midnight (server time)

## Setup

1. Copy `.env.example` to `.env` and set `DISCORD_TOKEN` and `CLIENT_ID` (application id).
2. `npm install`
3. `npm run deploy-commands` (registers global commands — can take up to 1 hour to propagate for global commands; for development use guild registration)
4. `npm start`

## Files
- `src/index.js` — main bot code
- `src/commands.js` — slash command definitions
- `src/deploy-commands.js` — helper to deploy commands
- `teto_config.json` — created automatically to store operating channel per guild
- `teto_submissions.json` — created automatically to store last submission dates per user/guild

## Notes
- This project uses Node ESM modules.
- For production, replace JSON persistence with a proper database.
