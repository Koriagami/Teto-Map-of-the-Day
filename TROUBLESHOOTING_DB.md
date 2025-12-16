# Troubleshooting Database Connection Issues

## Error: "Can't reach database server at `postgres.railway.internal:5432`"

This error means Railway CLI is trying to connect but can't reach the database. Here's how to fix it:

### Solution 1: Check PostgreSQL Service Status

1. **Go to Railway Dashboard**
   - Navigate to your PostgreSQL service
   - Check if it's **running** (green status)
   - If it's not running, wait a few minutes for it to start

2. **Check Service Logs**
   - Click on PostgreSQL service → Logs
   - Look for any errors or startup messages
   - Make sure it says "Ready" or "Listening"

### Solution 2: Verify Services Are Connected

1. **Check Both Services Are in Same Project**
   - Both bot service and PostgreSQL should be in the same Railway project
   - If they're in different projects, they can't communicate

2. **Verify DATABASE_URL is Set**
   - Go to your **bot service** (not PostgreSQL)
   - Click "Variables" tab
   - Look for `DATABASE_URL`
   - It should be automatically set by Railway

### Solution 3: Use Public URL (Temporary Workaround)

If the internal endpoint isn't working, you can temporarily use the public URL:

1. **Get Public URL**
   - Go to PostgreSQL service → Variables
   - Copy `DATABASE_PUBLIC_URL` (or `PGHOST`, `PGPORT`, etc.)

2. **Set in Bot Service**
   - Go to bot service → Variables
   - Add/update `DATABASE_URL` with the public URL
   - **Note:** This will incur egress fees, but works for testing

3. **Run Migration Again**
   ```bash
   railway run npx prisma migrate deploy
   ```

### Solution 4: Wait and Retry

Sometimes Railway needs a few minutes to:
- Start the PostgreSQL service
- Set up internal networking
- Propagate environment variables

**Wait 2-3 minutes** after creating PostgreSQL, then try again.

### Solution 5: Check Railway Project Settings

1. **Verify Service Networking**
   - Make sure both services are in the same project
   - Railway automatically sets up networking for services in the same project

2. **Check Service Dependencies**
   - In Railway dashboard, services should show they're connected
   - Look for connection indicators between services

### Solution 6: Alternative - Run Migration During Build

Instead of running migration separately, you can add it to your build process:

1. **Update `package.json` scripts:**
   ```json
   "scripts": {
     "postinstall": "prisma generate",
     "start": "prisma migrate deploy && node src/index.js"
   }
   ```

2. **This will:**
   - Generate Prisma client after install
   - Run migrations before starting the bot
   - Happens automatically on each deploy

### Quick Checklist

- [ ] PostgreSQL service is running (green status)
- [ ] Both services are in the same Railway project
- [ ] `DATABASE_URL` is set in bot service variables
- [ ] Waited 2-3 minutes after creating PostgreSQL
- [ ] Checked PostgreSQL service logs for errors

### Still Not Working?

Try these commands to debug:

```bash
# Check if DATABASE_URL is set
railway run env | grep DATABASE

# Check Railway service status
railway status

# View PostgreSQL service logs
railway logs --service <postgres-service-name>
```

