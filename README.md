# Teto Bot - Discord Bot

Discord bot for submitting and voting on osu! maps.

## Features

- **TMOTD:** `/teto map submit` — Submit map of the day (once per day, optional mods)
- **Challenges:** `/rsc [maplink]` — Issue or respond to score challenges. Win = 3+ of 5 key stats (PP or 300s when both PP 0, Accuracy, Max Combo, Score, Misses). Response shows comparison card + X/5 key stats. Champion can respond to own challenge (improve or “pretend Teto didn’t see that”).
- **Scores:** `/trs` — Record unranked/WIP score; `/tc` — Look up scores for a map
- **Setup:** `/teto setup` (admin), `/teto link` — Link Discord to OSU! (required for most commands)
- `/teto test` (admin) — Test UI (trs, tc, rsci, rscr, motd, report, card)
- Map links shown as **artist - map name [difficulty]**. Auto 👍/👎 with “meh” on 4+ dislikes.
- PostgreSQL + Prisma

## Quick Setup

- Click https://discord.com/oauth2/authorize?client_id=1447929535466049657&permissions=388160&integration_type=0&scope=bot+applications.commands
- Then use `/teto help` in any text channel for the following setup steps

## Selfhosting Setup (for Railway)

1. **Environment Variables** (`.env`):
   ```env
   DISCORD_TOKEN=your_token
   CLIENT_ID=your_app_id
   OSU_CLIENT_ID=your_osu_client_id
   OSU_CLIENT_SECRET=your_osu_secret
   DATABASE_URL=postgresql://...  # Auto-set on Railway
   PARENT_GUILD_ID=your_parent_guild_id  # Optional: Guild ID where rank emojis are stored
   ```

2. **Install & Run**:
   ```bash
   npm install
   npm run db:generate
   npm run deploy-commands
   npm start
   ```

3. **Railway Deployment**: See [RAILWAY_SETUP.md](./RAILWAY_SETUP.md)

## OSU! API Setup

1. Go to [osu! OAuth settings](https://osu.ppy.sh/home/account/edit#oauth)
2. Create new OAuth application
3. Copy Client ID and Secret to `.env`

## Database

PostgreSQL with Prisma:
- `server_configs` — Operating channels
- `submissions` — Daily submissions
- `user_associations` — Discord ↔ OSU links
- `active_challenges` — Score challenges
- `local_scores` — Stored unranked/WIP scores (for /trs, /tc)

View data: Railway dashboard or `npm run db:studio`
