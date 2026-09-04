# Dynasty Coordinator

A CFB 27 dynasty companion: a recruiting board built from your own roster,
national rankings and awards the game won't remember, and a permanent record
of your program's history. Started as a standalone copy of the "Recruit
Explorer" tab from Dynasty Tracker, split out into its own project so it
could evolve independently - the two are separate codebases now, not shared
code.

## What it does

Upload an EA Sports College Football 27 dynasty save file and get:

- **Recruiting Coordinator** - every recruit in the class rated against
  their peers (custom **Raw Rating** and **NIL Adjusted Rating**), national
  class-wide averages by position, and a personalized recruit target board
  built from your actual roster needs, depth chart, and NIL budget.
- **National Landscape** - a Top 25 poll (the save's own Media/Coaches/CFP
  polls plus a blended "Coordinator 25"), conference standings, awards races
  (live Heisman race plus 24 tracked season-ending awards), and national
  power rankings for every roster in the game.
- **Coaching Career** - your program's permanent record: head-to-head
  results against every school, bowl and playoff history, every recruiting
  class you've signed, and the best players who've ever played for you -
  all things the save file itself only ever shows a rolling window of, kept
  here for good.

Everything under National Landscape and Coaching Career is built up over
time from your own uploads (the save only ever exposes recent/current
state), stored per-account in a small local SQLite database - see
`lib/authDb.js` for the schema. Uploading requires no account; tracking
history across uploads does.

## Running it

```
npm install
npm start
```

Then open http://localhost:4000 (override the port with the `PORT` env var).

Personal/local use needs nothing else configured. For hosted (multi-tenant)
deployment - accounts, persistent history per user, admin dashboard - see
`DEPLOY.md`.

## Structure

- `server.js` - Express server: serves the frontend and the API routes.
- `lib/parse*.js` - Parse the save file (via `madden-franchise`) into plain
  data: recruits, rosters, national team/player stats, conferences, awards.
- `lib/*Ingest.js` / `lib/authDb.js` - Persist what the save doesn't retain
  (Top 25/conference history, awards, recruiting classes, notable players)
  into SQLite, scoped per account.
- `public/` - Frontend: upload dropzone, tabbed views, tables, and the
  history browsers.
