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

- **RSC (Respond to Score Challenge)**: Issue or respond to a score challenge. Win = 3+ of 5 key stats. Response posts a comparison card and (X/5 key stats). Champion responding to own challenge: better score → challenge updated; worse → "pretend Teto didn't see that".

- **Challenge**: One challenge per beatmap/difficulty. Tracks current champion (challengerUserId/challengerOsuId/challengerScore). **5 key metrics:** PP (or 300s when both PP are 0), Accuracy, Max Combo, Score, Misses (fewer is better). **Uncontested:** created but no responses (challengerUserId === originalChallengerUserId, updatedAt === createdAt).

- **Operating Channels**: Two separate channels per Discord server:
  - **tmotd**: Channel for daily map submissions
  - **challenges**: Channel for challenge announcements and results

- **Weekly Report**: An automated report (runs every Saturday at 16:00 UTC) that shows:
  - **New Champions**: Challenges where ownership changed in the last 30 days
  - **Uncontested Challenges**: Challenges created in last 30 days with no responses
  - **Defense Streaks**: Longest-held challenges (sorted by time held, top 5)

- **Score Comparison**: 5 key metrics — PP (or 300s when both PP are 0), Accuracy, Max Combo, Score, Misses (fewer is better). Responder wins with 3+ of 5. Card shows stat-by-stat winner; message shows (X/5 key stats). `compareScores()` in scoreHelpers.js; card in card.js.

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
│   ├── index.js           # Entry point: client setup, createEmbed, getOperatingChannel, createAndPostChallenge, context builders, event registration, cron, shutdown
│   ├── commandHandlers.js # Slash command handlers: /rsc, /tc, /trs, /teto (setup, link, help, test, map submit)
│   ├── commands.js        # Discord slash command definitions
│   ├── deploy-commands.js # Command deployment script
│   ├── db.js              # Database wrapper using Prisma
│   ├── osu-api.js         # osu! API v2 client with OAuth2
│   ├── helpers.js         # Beatmap link building, formatDifficultyLabel, getBeatmapAndLink
│   ├── emoji.js           # Emoji caching (initializeEmojis), formatRank, formatMapStatEmoji, formatTetoText
│   ├── scoreHelpers.js    # Score/challenge/beatmap helpers: compareScores, formatBeatmapLink, getMapTitle, getMapArtist, formatStarRating, formatPlayerStats, isValidScore, getBeatmapStatusName, isScoreSavedOnOsu, extractBeatmapInfoFromMessage, extractOsuProfile, etc.
│   ├── weeklyUpdate.js    # formatChallengeEntry, calculateTimeHeld, formatChallengeEntryWithDays, generateWeeklyUpdate(guildId, createEmbed)
│   ├── reactionHandler.js # handleMessageReactionAdd (👎 “meh” on TMOTD/Challenges)
│   ├── testHandlers.js    # /teto test implementations (trs, tc, rsci, rscr, motd, report, card)
│   ├── test-mock-data.js  # Mock score/beatmap data for tests
│   ├── card.js            # drawCardPrototype, drawChallengeCard (canvas)
│   └── verify-db.js       # Database verification utility
├── prisma/
│   ├── schema.prisma      # Database schema definition
│   ├── check-migration.js # Pre-start migration check
│   └── migrations/        # Database migration history
├── package.json           # Dependencies and scripts
└── README.md              # User-facing documentation
```

### Key Files

#### `src/index.js`
Entry point. Contains:
- Discord client setup, constants (BOT_EMBED_COLOR, PARENT_GUILD_ID), createEmbed, getOperatingChannel, todayString, createAndPostChallenge
- Context builders: buildRscTcContext(), buildTestContext(), buildTetoContext()
- Event registration: InteractionCreate (dispatches to handleRsc, handleTc, handleTrs, handleTeto), MessageReactionAdd (handleMessageReactionAdd), ClientReady (initializeEmojis)
- Cron: weekly update (Saturday 16:00 UTC), daily submission cleanup
- Graceful shutdown and client.login

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
- Functions: `getUser()`, `getBeatmap()`, `getUserRecentScores()`, `getUserBeatmapScore()`, `getUserBeatmapScoresAll()`, `extractBeatmapId()`, `extractScoreId()`, `getScoreById()`, `resolveMapOrScoreLink()`

#### `src/commandHandlers.js`
Slash command handlers (receive interaction + ctx):
- `handleRsc`, `handleTc`: challenge issue/respond and map scores (ctx from buildRscTcContext)
- `handleTrs`: record recent score, beatmap status, local save (ctx from buildRscTcContext)
- `handleTeto`: setup, link, help, test, map submit (ctx from buildTetoContext)

#### `src/scoreHelpers.js`
Score and beatmap helpers: `compareScores`, `extractScoreValue`, `formatBeatmapLink`, `getMapTitle`, `getMapArtist`, `formatStarRating`, `formatPlayerStats`, `formatPlayerStatsCompact`, `getBeatmapStatusName`, `isScoreSavedOnOsu`, `extractBeatmapInfoFromMessage`, `extractOsuProfile`, etc.

#### `src/weeklyUpdate.js`
Weekly report: `formatChallengeEntry`, `calculateTimeHeld`, `formatChallengeEntryWithDays`, `generateWeeklyUpdate(guildId, createEmbed)`. Index passes createEmbed and calls it from cron and from test report.

#### `prisma/schema.prisma`
Database schema with 5 models:
1. **ServerConfig**: Guild channel settings
2. **Submission**: Daily map submissions (one per user per day per guild)
3. **UserAssociation**: Discord-to-osu! profile links
4. **ActiveChallenge**: Score challenges with champion tracking
5. **LocalScore**: Stored unranked/WIP scores per guild/user (for /trs and /tc)

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

### `/rsc` (Respond to Score Challenge)
Issue or respond to a score challenge. No link = most recent score; with link = best score for that beatmap. Win = 3+ of 5 key stats (PP or 300s when both 0, Acc, Combo, Score, Misses). Posts comparison card + (X/5 key stats). Champion responding to own: improve → update challenge; fail → keep previous score, "pretend Teto didn't see that".

### `/teto test` (Admin only)
UI testing command that simulates the output of other commands without affecting real data.
- Options: `command` (required, choices: `trs`, `tc`, `rsci`, `rscr`, `motd`, `report`, `card`)
- Uses mock data from `src/test-mock-data.js` or random real data from database (read-only)
- **Never modifies database** - purely for UI testing
- Each option simulates:
  - `trs`: `/trs` command (singular most recent score)
  - `tc`: `/tc` command (list of scores)
  - `rsci`: Challenge issuing part of `/rsc`
  - `rscr`: Challenge responding part of `/rsc` (simple message, not embed)
  - `motd`: `/teto map submit` command
  - `report`: Weekly challenges report (uses real `generateWeeklyUpdate()` function)
  - `card`: Card prototype (avatar + username + 2 mock plays)

#### Test Commands Infrastructure
The test commands are designed to share infrastructure with real commands:

**Automatic Updates** (no manual changes needed):
- Test commands use the same helper functions as real commands:
  - Formatting: `formatPlayerStats()`, `formatPlayerStatsCompact()`, `formatDifficultyLabel()`, `formatStarRating()`, `formatMods()`, `formatBeatmapLink()`, `formatTetoText()`
  - Data fetching: `getBeatmapsetImageUrl()`, `getMapTitle()`, `getMapArtist()`, `getStarRating()`, `getBeatmap()`
  - Business logic: `compareScores()`, `createAndPostChallenge()`, `generateWeeklyUpdate()`
  - Embed creation: `createEmbed()`
- **If you update any helper function, test commands automatically reflect the changes**

**Manual Updates Required**:
- Test commands simulate the flow but don't call real command handlers directly
- Manual updates needed for:
  - Command flow/structure changes (new validation steps, order of operations)
  - Error handling logic specific to commands
  - Message structure/formatting not in helper functions
  - New features requiring different test data or flow

**Summary**: Helper function changes → automatic. Command structure/flow changes → manual update needed.

## Challenge Flow

1. **Issuing a Challenge**:
   - User runs `/rsc` (or `/rsc <maplink>`)
   - Bot fetches user's score for the beatmap
   - If challenge doesn't exist: Creates new challenge, posts announcement
   - If challenge exists: Proceeds to response flow

2. **Responding to Challenge**:
   - Fetches responder's score; compares on 5 key metrics (PP or 300s when both PP 0, Acc, Combo, Score, Misses).
   - 3+ wins → new champion (or same champion with better score if self-response). Posts card + (X/5 key stats).
   - Self-response and fail → no update, "pretend Teto didn't see that".

3. **Score Comparison**: `compareScores()`; card via `drawChallengeCard()`. Labels: artist - map name [difficulty].

## Weekly Report Logic

The weekly report (`generateWeeklyUpdate`) categorizes challenges:

1. **New Champions** (last 30 days):
   - `updatedAt >= 30 days ago` AND `updatedAt !== createdAt`
   - Means: Challenge ownership changed recently

2. **Uncontested Challenges** (last 30 days):
   - `createdAt >= 30 days ago` AND `challengerUserId === originalChallengerUserId` AND `updatedAt === createdAt`
   - Means: Created but never beaten

3. **Defense Streaks**:
   - Challenges never beaten; sorted by time held (top 5).
   - Format: `(★X.XX [artist - map name [difficulty]](link)) - <@userId> [Held for X days Y hours]`

## Environment Variables

Required in `.env`:
- `DISCORD_TOKEN`: Discord bot token
- `CLIENT_ID`: Discord application ID (for command deployment)
- `OSU_CLIENT_ID`: osu! OAuth application client ID
- `OSU_CLIENT_SECRET`: osu! OAuth application client secret
- `DATABASE_URL`: PostgreSQL connection string (auto-set on Railway)

Optional:
- `PARENT_GUILD_ID`: Discord Guild ID where rank emojis (rank_D, rank_C, rank_B, rank_A, rank_S, rank_SH, rank_SS, rank_SSH, rank_X, rank_XH) are stored. If set, the bot will use emojis from this guild across all servers. If not set, the bot will search all guilds for rank emojis.

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
- Difficulty labels: **artist - map name [difficulty]** (getMapArtist, formatDifficultyLabel).
- Discord markdown: `**bold**`, `[text](url)`, `<@userId>`, `<#channelId>`

## Deployment

- **Platform**: Railway
- **Auto-deploy**: On push to `main` branch
- **Start command**: `npm start` (runs migration check, deploys migrations, starts bot)
- **Build**: Runs `npm ci` and `prisma generate` (postinstall)

## Common Tasks for AI Assistants

When working on this codebase:

1. **Adding new commands**: Update `src/commands.js`, add handler in `src/commandHandlers.js` (and wire in `src/index.js` InteractionCreate), run `npm run deploy-commands`

2. **Database changes**: 
   - Update `prisma/schema.prisma`
   - Run `npm run db:migrate` (creates migration)
   - Test locally before pushing

3. **Modifying challenge logic**: `handleRsc` and response flow in `src/commandHandlers.js`; score comparison in `src/scoreHelpers.js` (`compareScores`)

4. **Weekly report changes**: `src/weeklyUpdate.js` — `generateWeeklyUpdate(guildId, createEmbed)`

5. **API changes**: Modify `src/osu-api.js`, ensure OAuth token handling remains intact

6. **Channel operations**: Use `getOperatingChannel()` (in index.js, passed via context), check permissions before posting

## Notes for AI

- The bot uses ES modules (`"type": "module"` in package.json)
- All async operations should be properly awaited
- Guild-specific operations must always filter by `guildId`
- Score data from osu! API is stored as JSON in database
- Challenge uniqueness is enforced at database level (unique constraint)
- Weekly reports and long embeds use createEmbed() which splits content when it exceeds 4096 characters (Discord embed description limit)
- The bot requires specific Discord intents: Guilds, GuildMessages, MessageContent, GuildMessageReactions
- Partials are enabled for Message, Reaction, and Channel to handle cached data





