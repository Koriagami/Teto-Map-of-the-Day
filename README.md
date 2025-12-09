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

Click the link - https://discord.com/oauth2/authorize?client_id=1447929535466049657&permissions=388160&integration_type=0&scope=bot+applications.commands

## Files
- `src/index.js` — main bot code
- `src/commands.js` — slash command definitions
- `src/deploy-commands.js` — helper to deploy commands
- `teto_config.json` — created automatically to store operating channel per guild
- `teto_submissions.json` — created automatically to store last submission dates per user/guild

## Notes
- This project uses Node ESM modules.
- For production, replace JSON persistence with a proper database.
