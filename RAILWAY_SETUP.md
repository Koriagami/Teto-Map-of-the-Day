# Railway PostgreSQL Setup

## Quick Steps

1. **Add PostgreSQL Service**
   - Railway Dashboard → "+ New" → "Database" → "Add PostgreSQL"
   - Wait for service to start

2. **Verify Connection**
   - Bot service automatically gets `DATABASE_URL` (private endpoint, no fees)
   - Check "Variables" tab in bot service
   - **Ignore** `DATABASE_PUBLIC_URL` warning (we use private endpoint)

3. **Deploy Migration**
   - Migrations run automatically on deploy (via `package.json` start script)
   - Or manually: `railway run npx prisma migrate deploy`

4. **Verify Tables**
   - Railway PostgreSQL dashboard → Data tab
   - Should see: `server_configs`, `submissions`, `user_associations`, `active_challenges`, `local_scores`

## Troubleshooting

- **"DATABASE_URL not found"**: Ensure PostgreSQL and bot are in same Railway project
- **"Migration failed"**: Check Railway logs, ensure PostgreSQL service is running
- **"DATABASE_PUBLIC_URL warning"**: Safe to ignore (we use `DATABASE_URL`)

## Notes

- `DATABASE_URL` = Private endpoint (no egress fees) ✅
- `DATABASE_PUBLIC_URL` = Public endpoint (fees) ❌ Don't use
- Migrations auto-run on deploy via `check-migration.js`
