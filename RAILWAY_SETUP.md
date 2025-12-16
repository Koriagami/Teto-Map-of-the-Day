# Railway PostgreSQL Setup Guide

This guide will walk you through setting up PostgreSQL on Railway for your Discord bot.

## Step 1: Add PostgreSQL Service on Railway

1. **Go to Railway Dashboard**
   - Navigate to: https://railway.app/dashboard
   - Select your bot project

2. **Add PostgreSQL Database**
   - Click **"+ New"** button (top right)
   - Select **"Database"** → **"Add PostgreSQL"**
   - Railway will automatically create a PostgreSQL database service
   - Wait a few seconds for the database to initialize

3. **Verify Service Created**
   - You should see a new service called "Postgres" or similar
   - The service status should be green/running

## Step 2: Connect PostgreSQL to Your Bot Service

Railway automatically shares environment variables between services in the same project.

1. **Select Your Bot Service**
   - Click on your bot service (not the PostgreSQL service)

2. **Check Variables Tab**
   - Go to **"Variables"** tab
   - You should see `DATABASE_URL` automatically added (this is the **private endpoint** - no egress fees)
   - It should look like: `postgresql://postgres:password@hostname:port/railway`
   - **Important:** Use `DATABASE_URL` (private), NOT `DATABASE_PUBLIC_URL` (public - incurs egress fees)
   - **You don't need to copy this manually** - Railway handles it!

3. **Verify Connection**
   - If `DATABASE_URL` is not visible, make sure:
     - Both services are in the same Railway project
     - PostgreSQL service is running (green status)
     - Wait a minute and refresh

4. **Avoid Egress Fees**
   - Railway may show a warning about `DATABASE_PUBLIC_URL` - **ignore this**
   - We use `DATABASE_URL` which is the private endpoint (no fees)
   - Only use `DATABASE_PUBLIC_URL` if you need to connect from outside Railway

## Step 3: Install Dependencies Locally

```bash
npm install
```

This installs:
- `@prisma/client` - Prisma client for database operations
- `prisma` - Prisma CLI for migrations

## Step 4: Generate Prisma Client

```bash
npm run db:generate
```

This generates the Prisma Client based on your schema.

## Step 5: Create Initial Migration

```bash
npm run db:migrate
```

This will:
- Create a new migration file
- Ask for a migration name (e.g., "init_postgresql")
- **Note:** This applies to your local database if you have one set up
- The Railway database will be migrated in the next step

## Step 6: Deploy Migration to Railway

You have two options:

### Option A: Using Railway CLI (Recommended)

```bash
# Install Railway CLI if not already installed
npm i -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Deploy migration to Railway's PostgreSQL
railway run npx prisma migrate deploy
```

### Option B: Using Railway Dashboard

1. Go to your **bot service** (not PostgreSQL)
2. Click **"Deployments"** tab
3. Click on the **latest deployment**
4. Click **"View Logs"** → **"Shell"** tab
5. Run: `npx prisma migrate deploy`

This will:
- Create all tables in Railway's PostgreSQL database
- Set up indexes and constraints
- **Safe for production** (uses `migrate deploy`, not `migrate dev`)

## Step 7: Verify Migration

### Check Railway PostgreSQL Dashboard

1. Go to your **PostgreSQL service** in Railway
2. Click on the service
3. Railway provides a built-in **data viewer**
4. You should see your tables:
   - `server_configs`
   - `submissions`
   - `user_associations`

### Or Use Prisma Studio (Optional)

```bash
railway run npx prisma studio
```

Then expose port 5555 in Railway to access it via browser.

## Step 8: Test Your Bot

1. **Redeploy your bot** (Railway should auto-deploy on git push)
2. **Test commands:**
   - `/teto setup` - Should save to PostgreSQL
   - `/teto link` - Should save association to PostgreSQL
   - `/teto map submit` - Should save submission to PostgreSQL

## Troubleshooting

### "DATABASE_URL not found"

**Solution:**
- Make sure PostgreSQL service is in the same Railway project
- Check that your bot service has access to the PostgreSQL service
- Railway should auto-share variables between services
- Try disconnecting and reconnecting the services

### "Migration failed" or "Connection refused"

**Solution:**
- Wait a few minutes after creating PostgreSQL service (it needs to start)
- Check Railway PostgreSQL service logs
- Verify the service is running (green status)
- Make sure `DATABASE_URL` is set in your bot service variables

### "Prisma Client not generated"

**Solution:**
- Run `npm run db:generate` locally first
- Make sure `@prisma/client` is in your `package.json` dependencies
- Railway will run `npm install` during build, which includes Prisma Client

### "Tables not created"

**Solution:**
- Make sure you ran `railway run npx prisma migrate deploy`
- Check Railway deployment logs for errors
- Verify `DATABASE_URL` is correct in Railway variables

### "DATABASE_PUBLIC_URL warning about egress fees"

**Solution:**
- ✅ **This warning is safe to ignore!**
- We use `DATABASE_URL` (private endpoint), not `DATABASE_PUBLIC_URL` (public endpoint)
- The warning appears because Railway creates both variables, but we only use the private one
- As long as your code uses `DATABASE_URL` (which it does), you won't incur egress fees
- You can safely ignore this warning or hide `DATABASE_PUBLIC_URL` if it bothers you

## Benefits of PostgreSQL on Railway

✅ **Persistent** - Data survives redeployments  
✅ **Scalable** - Can handle more concurrent connections  
✅ **Built-in Viewer** - Railway provides a data viewer  
✅ **Backups** - Railway handles backups automatically  
✅ **Production Ready** - Proper database for production use  
✅ **Accessible** - Easy to view and manage data via Railway dashboard  
✅ **No Egress Fees** - Using private `DATABASE_URL` endpoint (services in same project)

## About Database URLs

Railway provides two database connection URLs:

- **`DATABASE_URL`** (Private) - ✅ **Use this one!**
  - Private endpoint for services in the same Railway project
  - **No egress fees**
  - This is what we use in `prisma/schema.prisma`

- **`DATABASE_PUBLIC_URL`** (Public) - ⚠️ **Don't use this**
  - Public endpoint for external connections
  - **Incurs egress fees**
  - Only use if connecting from outside Railway

**Our code uses `DATABASE_URL` (private), so you won't incur egress fees!**  

## Local Development (Optional)

If you want to test locally with PostgreSQL:

1. Install PostgreSQL locally or use Docker
2. Set `DATABASE_URL` in your local `.env`:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/teto_db"
   ```
3. Run migrations: `npm run db:migrate`
4. Generate client: `npm run db:generate`

Or use Railway's PostgreSQL for local development too (not recommended for heavy testing).

## Next Steps

- Your bot now uses PostgreSQL on Railway!
- Data is persistent and won't be lost on redeployments
- You can view data via Railway's PostgreSQL dashboard
- Consider setting up regular backups (Railway Pro feature)

