# Recruiting Coordinator

This is a standalone copy of the "Recruit Explorer" tab from Dynasty Tracker,
split out into its own project (and renamed) so it can be developed
independently without touching the main app. The two are separate copies
now, not shared code - changes made here won't affect Dynasty Tracker's
built-in Recruit Explorer, and vice versa.

## What it does

Upload an EA Sports College Football 27 dynasty save file and get a
filterable, sortable, paginated table of every recruit in the class, each
enriched with a custom **Raw Rating** and **NIL Adjusted Rating**.

## Running it

```
npm install
npm start
```

Then open http://localhost:4000 (override the port with the `PORT` env var).

## Structure

- `server.js` - Express server: serves the frontend and exposes `POST /api/upload`.
- `lib/parseRecruits.js` - Parses the save file (via `madden-franchise`) and computes ratings.
- `public/` - Frontend: upload dropzone, filter/sort toolbar, results table, pager.

No database, no config file, no persistence - this tool is stateless by
design: upload a save, see the current recruiting class, done.
