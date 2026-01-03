# AI Context Document for Teto Bot

This document provides comprehensive context about the Teto Bot project for AI assistants working on this codebase.

## Project Overview

**Teto Bot** is a Discord bot for the osu! rhythm game community. It allows users to:
- Submit and vote on daily map recommendations (TMOTD - Teto Map of the Day)
- Issue and respond to score challenges between players
- Link Discord accounts to osu! profiles
- Generate weekly challenge reports

## Key Terminology

### Core Concepts

- **TMOTD (Teto Map of the Day)**: A daily map submission feature where users can submit one map per day to a designated channel. Other users can react with 👍 or 👎. If 4+ 👎 reactions are received, the message is edited to show "voted to be meh".

- **RSC (Respond to Score Challenge)**: A command that allows users to either:
  - Issue a new challenge using their most recent score
  - Respond to an existing challenge for a specific beatmap/difficulty

- **Challenge**: A competitive system where a player issues a challenge by posting their score on a beatmap. Other players can respond by beating that score. The challenge tracks:
  - **Challenger**: The current player holding the best score (champion)
  - **Original Challenger**: The player who first issued the challenge
  - **Champion**: The player with the best score (can change when someone beats it)
  - **Uncontested Challenge**: A challenge that was created but never had any responses (challengerUserId === originalChallengerUserId and updatedAt === createdAt)

- **Operating Channels**: Two separate channels per Discord server:
  - **tmotd**: Channel for daily map submissions
  - **challenges**: Channel for challenge announcements and results

- **Weekly Report**: An automated report (runs every Saturday at 16:00 UTC) that shows:
  - **New Champions**: Challenges where ownership changed in the last 30 days
  - **Uncontested Challenges**: Challenges created in last 30 days with no responses
  - **Defense Streaks**: Longest-held challenges (sorted by time held, top 5)

- **Score Comparison**: When responding to a challenge, the bot compares:
  - PP (Performance Points)
  - Accuracy
  - Max Combo
  - Score value
  - Misses (fewer is better)
  
  The responder wins if they win 3+ out of 5 metrics. If they win, they become the new champion.

### Database Terms

- **Guild**: Discord server (guildId is the Discord server ID)
- **Beatmap**: An osu! map/song. Each beatmap has:
  - **beatmapId**: Unique identifier
  - **difficulty**: The difficulty name/version (e.g., "Hard", "Insane")
  - **beatmapset**: Collection of beatmaps (one song can have multiple difficulties)

- **Association**: Links a Discord user to their osu! profile (one-to-one per guild)

## Architecture

### Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Discord.js v14
- **Database**: PostgreSQL with Prisma ORM
- **Deployment**: Railway (auto-deploys from main branch)
- **Package Manager**: npm

### Project Structure

```
/
├── src/
│   ├── index.js          # Main bot logic, event handlers, command handlers
│   ├── commands.js        # Discord slash command definitions
│   ├── deploy-commands.js # Command deployment script
│   ├── db.js             # Database wrapper using Prisma
│   ├── osu-api.js         # osu! API v2 client with OAuth2
│   └── verify-db.js       # Database verification utility
├── prisma/
│   ├── schema.prisma     # Database schema definition
│   ├── check-migration.js # Pre-start migration check
│   └── migrations/       # Database migration history
├── package.json          # Dependencies and scripts
└── README.md            # User-facing documentation
```

### Key Files

#### `src/index.js`
Main entry point. Contains:
- Discord client setup and event handlers
- Command handlers for `/teto` and `/rsc`
- Reaction monitoring for 👎 votes
- Weekly report generation (`generateWeeklyUpdate`)
- Score comparison logic (`compareScores`)
- Helper functions for formatting and validation

#### `src/db.js`
Database abstraction layer. Exports:
- `serverConfig`: Channel configuration per guild
- `submissions`: Daily submission tracking
- `associations`: Discord ↔ osu! profile links
- `activeChallenges`: Challenge management
- `disconnect()`: Cleanup function

#### `src/osu-api.js`
osu! API v2 client. Handles:
- OAuth2 token management (client credentials flow)
- API requests with automatic token refresh
- Functions: `getUser()`, `getBeatmap()`, `getUserRecentScores()`, `getUserBeatmapScore()`, `extractBeatmapId()`

#### `prisma/schema.prisma`
Database schema with 4 models:
1. **ServerConfig**: Guild channel settings
2. **Submission**: Daily map submissions (one per user per day per guild)
3. **UserAssociation**: Discord-to-osu! profile links
4. **ActiveChallenge**: Score challenges with champion tracking

## Database Schema Details

### ServerConfig
- `guildId` (unique): Discord server ID
- `tmotdChannelId`: Channel for map submissions
- `challengesChannelId`: Channel for challenges

### Submission
- Tracks one submission per user per day per guild
- Unique constraint on `[guildId, userId, submissionDate]`
- `submissionDate`: YYYY-MM-DD format string

### UserAssociation
- Links Discord users to osu! profiles
- One association per Discord user per guild
- Stores: `discordUserId`, `osuUserId`, `osuUsername`, `profileLink`

### ActiveChallenge
- One challenge per `[guildId, beatmapId, difficulty]` combination
- `challengerUserId`: Current champion (Discord ID)
- `challengerOsuId`: Current champion (osu! ID)
- `challengerScore`: Full score JSON from osu! API
- `originalChallengerUserId`: Who first issued the challenge
- `createdAt`: When challenge was created
- `updatedAt`: When champion last changed (used for defense streak calculation)

## Command Reference

### `/teto setup` (Admin only)
Sets the current channel as either TMOTD or Challenges channel.
- Options: `set_this_channel_for` (tmotd | challenges)

### `/teto link`
Links Discord account to osu! profile.
- Options: `profilelink` (must contain "osu.ppy.sh/users/")
- Validates profile exists via osu! API
- One link per Discord user per guild

### `/teto map submit`
Submit a map for TMOTD (once per day per guild).
- Options: `maplink` (required), `recommended_mod_1` through `recommended_mod_5` (optional)
- Posts to TMOTD channel with 👍/👎 reactions
- Valid mods: EZ, NF, HT, HR, SD, PF, DT, NC, HD, FL, RL, SO, SV2

### `/teto get_c_report` (Admin only)
Manually trigger weekly challenges report.
- Posts to Challenges channel
- Same format as automated weekly report

### `/rsc` (Respond to Score Challenge)
Issue or respond to a score challenge.
- Without parameter: Uses most recent score to issue/respond
- With `respond_for_map_link`: Responds to challenge for that specific beatmap
- Requires linked osu! profile
- If challenge exists: Compares scores and updates champion if responder wins
- If no challenge: Creates new challenge

## Challenge Flow

1. **Issuing a Challenge**:
   - User runs `/rsc` (or `/rsc <maplink>`)
   - Bot fetches user's score for the beatmap
   - If challenge doesn't exist: Creates new challenge, posts announcement
   - If challenge exists: Proceeds to response flow

2. **Responding to Challenge**:
   - Bot fetches responder's score for the challenge beatmap
   - Compares scores on 5 metrics (PP, Accuracy, Combo, Score, Misses)
   - If responder wins 3+ metrics: Updates champion, posts comparison
   - If responder loses: Posts comparison, champion remains

3. **Score Comparison**:
   - Creates formatted table showing all stats
   - Determines winner per metric
   - Final winner: Player with most metric wins (3+ required to win challenge)

## Weekly Report Logic

The weekly report (`generateWeeklyUpdate`) categorizes challenges:

1. **New Champions** (last 30 days):
   - `updatedAt >= 30 days ago` AND `updatedAt !== createdAt`
   - Means: Challenge ownership changed recently

2. **Uncontested Challenges** (last 30 days):
   - `createdAt >= 30 days ago` AND `challengerUserId === originalChallengerUserId` AND `updatedAt === createdAt`
   - Means: Created but never beaten

3. **Defense Streaks**:
   - All active challenges where `updatedAt === createdAt` (never changed hands)
   - Sorted by time held (oldest first = longest defense)
   - Shows top 5
   - Format: `**Map Name** [[Difficulty]](link) - <@userId> [Held for X days Y hours]`

## Environment Variables

Required in `.env`:
- `DISCORD_TOKEN`: Discord bot token
- `CLIENT_ID`: Discord application ID (for command deployment)
- `OSU_CLIENT_ID`: osu! OAuth application client ID
- `OSU_CLIENT_SECRET`: osu! OAuth application client secret
- `DATABASE_URL`: PostgreSQL connection string (auto-set on Railway)

## Important Code Patterns

### Error Handling
- Commands use `deferReply()` for long operations
- Database operations wrapped in try-catch
- API calls handle null/undefined gracefully
- Validation happens before database operations

### Guild Isolation
- All database queries filter by `guildId`
- Weekly reports process each guild separately
- No cross-guild data mixing

### Date Handling
- Uses ISO date strings (YYYY-MM-DD) for submissions
- Uses JavaScript Date objects for challenge timestamps
- UTC timezone for cron jobs

### Score Data Structure
osu! API score objects contain:
- `beatmap.id`: Beatmap ID
- `beatmap.version`: Difficulty name
- `beatmap.beatmapset_id`: Beatmapset ID
- `pp`: Performance points
- `accuracy`: 0-1 decimal
- `max_combo`: Maximum combo
- `score`: Score value
- `statistics.count_300`, `count_100`, `count_50`, `count_miss`
- `rank`: Letter grade (S, A, B, etc.)

### Message Formatting
- Uses Discord markdown: `**bold**`, `*italic*`, `[text](url)`
- Code blocks for tables: ` ``` `
- Mentions: `<@userId>`
- Channel mentions: `<#channelId>`

## Deployment

- **Platform**: Railway
- **Auto-deploy**: On push to `main` branch
- **Start command**: `npm start` (runs migration check, deploys migrations, starts bot)
- **Build**: Runs `npm ci` and `prisma generate` (postinstall)

## Common Tasks for AI Assistants

When working on this codebase:

1. **Adding new commands**: Update `src/commands.js`, add handler in `src/index.js`, run `npm run deploy-commands`

2. **Database changes**: 
   - Update `prisma/schema.prisma`
   - Run `npm run db:migrate` (creates migration)
   - Test locally before pushing

3. **Modifying challenge logic**: Check `src/index.js` around line 260-530 for `/rsc` handler

4. **Weekly report changes**: See `generateWeeklyUpdate()` function around line 928

5. **API changes**: Modify `src/osu-api.js`, ensure OAuth token handling remains intact

6. **Channel operations**: Use `getOperatingChannel()` helper, check permissions before posting

## Notes for AI

- The bot uses ES modules (`"type": "module"` in package.json)
- All async operations should be properly awaited
- Guild-specific operations must always filter by `guildId`
- Score data from osu! API is stored as JSON in database
- Challenge uniqueness is enforced at database level (unique constraint)
- Weekly reports split messages if they exceed 2000 characters (Discord limit)
- The bot requires specific Discord intents: Guilds, GuildMessages, MessageContent, GuildMessageReactions
- Partials are enabled for Message, Reaction, and Channel to handle cached data

