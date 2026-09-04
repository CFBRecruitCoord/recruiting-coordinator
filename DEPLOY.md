# Deploying Dynasty Coordinator (hosted / multi-tenant mode)

This app runs in two modes from the same codebase:

- **Personal mode** (default, `MULTI_TENANT_MODE` unset) — no login, refresh-from-local-path
  works. This is what you already run on your own machine. Nothing about deploying
  changes that.
- **Hosted mode** (`MULTI_TENANT_MODE=true`) — login is optional (the app works
  fully without an account; login is only needed for admin access and leaving
  feedback/bug reports), disables the local-path refresh feature (upload-only),
  tracks anonymous usage stats for the admin tab, and needs a durable place to
  store accounts/stats.

## Why Railway

The one hard requirement for hosting this: **accounts live in a SQLite file
(`data/auth.db`) that must survive restarts and redeploys.** Most hosting
platforms wipe local disk on every deploy by default (that includes Vercel/Netlify
entirely - no persistent disk at all, so they're ruled out without a rewrite to
Postgres). Railway supports attaching a persistent **Volume** to a normal web
service with minimal setup, has no cold-start/sleep behavior on its paid tier
(unlike Render's free tier, which spins down and delays the first request after
inactivity), and deploys straight from a GitHub repo with no config files
required. Fly.io is a reasonable alternative if you'd rather use it - same volume
concept, slightly more CLI-driven setup.

## What's already done

- Code is deployment-ready: reads `PORT` from the environment, respects
  `MULTI_TENANT_MODE`, and the auth database path is configurable via `DATA_DIR`.
- `package.json` pins `"engines": { "node": ">=24.0.0" }` - required, since
  `node:sqlite` doesn't exist before Node 22.5 and isn't stable until Node 24.
  Railway's build system (Nixpacks) reads this field to provision the right
  Node version automatically.
- Local git repo is initialized with an initial commit.

## Steps you'll need to do yourself

These require your own accounts - I can't create them on your behalf.

### 1. Push this repo to GitHub
```
git remote add origin https://github.com/<your-username>/recruiting-coordinator.git
git branch -M main
git push -u origin main
```
(Create the empty repo on github.com first, or via `gh repo create` if you have
the GitHub CLI installed and authenticated.)

**Before pushing**, fix the placeholder commit identity I used since none was
configured locally:
```
git config user.name "Your Name"
git config user.email "your@email.com"
git commit --amend --reset-author --no-edit
```

### 2. Create a Railway account and new project
At [railway.app](https://railway.app), sign up, then "New Project" → "Deploy from
GitHub repo" → select `recruiting-coordinator`. Railway auto-detects it's a
Node app and deploys it.

### 3. Add a persistent Volume
In the service's Settings → Volumes → "New Volume". Mount it at `/app/data`
(Railway's default working directory for a deployed service is `/app`, so this
lines up with where the app's `data/` folder resolves by default - but since
we made it configurable, the exact mount path just needs to match whatever you
set `DATA_DIR` to in the next step).

### 4. Set environment variables
In Settings → Variables:
```
MULTI_TENANT_MODE=true
DATA_DIR=/app/data
```
(`PORT` is injected automatically by Railway - don't set it yourself.)

### 5. Redeploy and verify
Railway redeploys automatically when you add variables/volumes. Once it's live:
- Visit the Railway-provided URL - it should redirect to `/login.html`
- Sign up for a test account, confirm you land on the app
- Restart the service (Settings → Restart) and confirm your test account still
  works afterward - this is the real test that the volume is wired up correctly

### 6. (Optional) Custom domain
Settings → Networking → Custom Domain, then point your domain's DNS at Railway
per their instructions.

## What's still not built

- Stripe billing / paywall - you mentioned adding this later
- Any UI indicating trial status, since there's no trial concept wired up yet
- Rate limiting / abuse protection on signup (worth adding before any real traffic)
