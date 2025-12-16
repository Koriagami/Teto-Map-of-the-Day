# How to Access Shell/Bash in Railway

There are several ways to access the command line (bash/shell) in Railway:

## Method 1: Railway CLI (Most Reliable - Recommended)

If you can't find the Shell button in the dashboard, use Railway CLI:

1. **Install Railway CLI** (if not already installed)
   ```bash
   npm i -g @railway/cli
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```
   - This opens your browser to authenticate

3. **Link to Your Project**
   ```bash
   railway link
   ```
   - Select your project when prompted
   - Select your bot service when prompted

4. **Run Commands Directly** (Easiest - No Interactive Shell Needed)
   ```bash
   railway run npx prisma migrate deploy
   ```
   - This runs the command and shows output
   - No need to open an interactive shell

5. **OR Open Interactive Shell** (If You Need It)
   ```bash
   railway shell
   ```
   - This opens an interactive bash shell
   - Run commands, then type `exit` to close

## Method 2: Railway Dashboard - Finding Shell (If Available)

The Shell button location may vary. Try these locations:

1. **Go to Your Service**
   - Railway Dashboard → Your Project → Bot Service

2. **Try These Locations:**
   - **Deployments Tab:** Click "Deployments" → Latest deployment → Look for "Shell" or "Terminal" button
   - **Service Header:** Look for a terminal/console icon in the top right
   - **Logs View:** Click "Logs" → Look for "Shell" tab next to "Logs" tab
   - **Settings:** Service → Settings → Look for "Shell" or "Terminal" option
   - **Service Actions:** Look for a dropdown menu with "Open Shell" option

3. **If Still Not Found:**
   - The Shell feature might not be available in your Railway plan
   - Use Railway CLI instead (Method 1 above)

## Method 2: Railway Dashboard - Service Logs Shell

1. **Go to Your Service**
   - Click on your bot service

2. **View Logs**
   - Click **"View Logs"** or the logs icon
   - Look for **"Shell"** tab (next to "Logs" tab)
   - Click on **"Shell"** tab

3. **Run Commands**
   - You now have access to the shell
   - Run your commands here

## Method 3: Railway CLI (Command Line)

If you prefer using your local terminal:

1. **Install Railway CLI**
   ```bash
   npm i -g @railway/cli
   ```

2. **Login**
   ```bash
   railway login
   ```

3. **Link to Your Project**
   ```bash
   railway link
   ```
   - Select your project when prompted

4. **Access Shell**
   ```bash
   railway shell
   ```
   - This opens an interactive shell in your Railway service
   - Run commands directly
   - Type `exit` to return to your local terminal

5. **Run Commands Directly (Without Interactive Shell)**
   ```bash
   railway run <command>
   ```
   - Example: `railway run npx prisma migrate deploy`
   - This runs the command and returns output

## Method 4: Railway Dashboard - Service Settings

Some Railway interfaces have a terminal icon directly in the service view:
- Look for a **terminal/console icon** in the service header
- Click it to open a shell

## Common Commands to Run in Railway Shell

Once you have shell access, you can run:

```bash
# Database migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Check environment variables
echo $DATABASE_URL

# View files
ls -la

# Check Node version
node --version

# Check if Prisma is installed
npx prisma --version
```

## Troubleshooting

### "Shell tab not visible"
- Make sure you're looking at a **deployment**, not just the service overview
- Try refreshing the page
- Check if your service is running (green status)

### "Permission denied"
- Make sure you're accessing the correct service
- Some commands might need to be run with `npx` prefix

### "Command not found"
- Use `npx` prefix for npm packages: `npx prisma migrate deploy`
- Or use full paths if needed

## Quick Reference

**Most Reliable:** Railway CLI
```bash
railway run npx prisma migrate deploy
```

**If Shell Available in Dashboard:** Railway Dashboard → Your Service → Deployments → Latest → Shell tab

**Note:** If you can't find Shell in dashboard, Railway CLI is the recommended method.

