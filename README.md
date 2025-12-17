# Teto Bot - Discord Bot

Discord bot for submitting and voting on osu! maps.

## Features

- `/teto setup` (admin) — Set operating channel
- `/teto link <profile>` — Link Discord to OSU! profile
- `/teto map submit <maplink> [mods]` — Submit map (once per day)
- `/rsc [maplink]` — Issue or respond to score challenges
- `/test <maplink>` — Test OSU! API leaderboards
- Auto reactions (👍/👎) with "meh" message on 4+ dislikes
- PostgreSQL database with Prisma ORM

## Quick Setup

1. **Environment Variables** (`.env`):
   ```env
   DISCORD_TOKEN=your_token
   CLIENT_ID=your_app_id
   OSU_CLIENT_ID=your_osu_client_id
   OSU_CLIENT_SECRET=your_osu_secret
   DATABASE_URL=postgresql://...  # Auto-set on Railway
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

View data: Railway dashboard or `npm run db:studio`
