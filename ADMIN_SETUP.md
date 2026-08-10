# Harn Kun admin analytics setup

The admin dashboard is available at `https://Harn.fun/admin`. Public visitors do not need to log in.

## 1. Create the analytics database

Create a Neon Postgres database and copy its connection string. The app creates its analytics tables automatically on the first request; no manual SQL migration is required.

## 2. Add Vercel environment variables

Add these variables to Production, Preview, and Development as needed:

- `DATABASE_URL`: the Neon Postgres connection string
- `ADMIN_PASSWORD`: a long, unique password used only for this dashboard
- `ADMIN_SESSION_SECRET`: at least 32 random characters used to sign admin sessions

Generate a strong session secret in PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Keep all three values private. Do not put real values in `.env.example` or commit them to Git.

## 3. Redeploy and sign in

Environment variable changes apply only to new Vercel deployments. Redeploy the project, then open `https://Harn.fun/admin` and enter `ADMIN_PASSWORD`.

## What is counted

- **Online now:** anonymous browsers active within the last two minutes
- **Users today:** unique anonymous browsers seen today
- **All-time users:** unique anonymous browsers since tracking was deployed
- **Daily users:** unique anonymous browsers for each of the last 30 days

Each browser receives a first-party anonymous cookie. No names, email addresses, bill images, bill items, or receipt contents are stored in the analytics tables. Clearing cookies or using another browser/device counts as a new user, so the figures are estimates.
