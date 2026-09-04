const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Defaults to a folder inside the repo (fine for personal/local use, where
// nothing needs to survive a redeploy). In hosted mode this MUST point at a
// persistent volume instead - most hosting platforms wipe local disk on
// every deploy, which would silently delete every user account otherwise.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'auth.db');

let db = null;

/**
 * Accounts + sessions for the hosted (multi-tenant) mode. Deliberately kept
 * out of any dynasty-data database - this file only ever holds emails,
 * password hashes, and opaque session tokens, nothing about a user's save
 * files. SQLite is a fine fit at this stage (same choice already proven in
 * Dynasty Tracker's lib/db.js) - it's a straightforward swap for a hosted
 * Postgres instance later if/when running more than one server process.
 */
function getAuthDb() {
    if (db) return db;

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            trial_ends_at TEXT,
            subscription_status TEXT NOT NULL DEFAULT 'none',
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );

        -- Usage stats for the admin tab - deliberately just counts/metadata
        -- (who, when, whether it succeeded, how many recruits/players it
        -- found), never the parsed save data itself. That still lives
        -- entirely in browser memory per-request, same as always. visitor_id
        -- is the fallback attribution for the (now-typical) case of an
        -- anonymous upload - see the migration below for existing databases
        -- that predate this column.
        CREATE TABLE IF NOT EXISTS upload_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            visitor_id TEXT,
            created_at TEXT NOT NULL,
            success INTEGER NOT NULL,
            recruit_count INTEGER,
            roster_count INTEGER,
            error_message TEXT
        );

        -- User-submitted comments/bug reports, reviewed from the admin tab.
        -- page_context is a free-text hint of which tab the user was on
        -- (set by the feedback page's dropdown), not a hard reference to
        -- anything - purely informational for whoever reviews it.
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            page_context TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            created_at TEXT NOT NULL
        );

        -- Anonymous unique-visitor counter for the admin tab - covers
        -- everyone who lands on the site, not just people who create an
        -- account. visitor_id is a random ID in a non-identifying cookie
        -- (see lib/visitors.js), never an email/IP/anything personal. The
        -- (visitor_id, visit_date) unique index caps this at one row per
        -- visitor per calendar day, regardless of how many pages they load.
        CREATE TABLE IF NOT EXISTS site_visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_id TEXT NOT NULL,
            visit_date TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        -- Coaching Career / Rivalries & Records. The save file only exposes a
        -- small rolling window of recent game results (not a permanent
        -- archive), so this is built up ourselves across many uploads over a
        -- dynasty's lifetime - same "accumulate what the game doesn't"
        -- pattern already proven in the original local Dynasty Tracker build
        -- this was ported from. user_id here is deliberately NOT a foreign
        -- key against users(id): personal mode has no login at all, and uses
        -- the reserved sentinel 0 ("the local dynasty") instead of a real
        -- user id, which would violate a real FK constraint. Hosted mode
        -- always uses a real user id - this feature requires an account
        -- there (see dynastyRecordsGate in server.js), both because tracking
        -- a career over time needs a durable identity a cookie can't give,
        -- and because it's exactly the kind of feature worth an account.
        CREATE TABLE IF NOT EXISTS dynasty_teams_meta (
            user_id INTEGER NOT NULL,
            team_index INTEGER NOT NULL,
            name TEXT, mascot TEXT, abbr TEXT,
            color_primary TEXT, color_secondary TEXT, state TEXT,
            PRIMARY KEY (user_id, team_index)
        );

        -- Every real (non-playoff) bowl slot the save knows about, so a bowl
        -- never played yet can still show up at 0-0 instead of being omitted.
        CREATE TABLE IF NOT EXISTS dynasty_bowls_meta (
            user_id INTEGER NOT NULL,
            bowl_index INTEGER NOT NULL,
            name TEXT,
            PRIMARY KEY (user_id, bowl_index)
        );

        -- One row per completed game the user's team has played, deduplicated
        -- on (user_id, season_year, season_week, opponent_team_index) so
        -- re-uploading a save whose rolling results window overlaps an
        -- earlier upload just re-confirms those games instead of duplicating
        -- them. Deliberately lean (W-L/score only, no box-score stat columns)
        -- since Every School/Bowl Games/Playoffs only ever need records, not
        -- stats - keeps each row tiny given this grows for as long as a
        -- dynasty (and the hosted account) is alive.
        CREATE TABLE IF NOT EXISTS dynasty_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            season_year INTEGER NOT NULL,
            season_week INTEGER NOT NULL,
            opponent_team_index INTEGER NOT NULL,
            is_home INTEGER NOT NULL,
            my_score INTEGER,
            opp_score INTEGER,
            result TEXT,
            is_bowl INTEGER,
            is_playoff INTEGER DEFAULT 0,
            bowl_index INTEGER,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, season_year, season_week, opponent_team_index)
        );

        -- Top 25 Poll. Unlike dynasty_games, most of what a snapshot needs
        -- (season-cumulative yards/TDs/sacks/turnovers, win-loss) is already
        -- computed and stored BY THE SAVE ITSELF on each team's TeamStats
        -- record - no need to reconstruct it from individual games. What the
        -- save doesn't retain is WEEKLY granularity (only "current" and the
        -- final tallies of the last few completed seasons), so this table
        -- exists purely to remember what a user's own current season looked
        -- like week-to-week as they play through it. A completed season's
        -- FINAL standings get a synthetic row with season_week = -1 (a
        -- season always has real weeks >= 0, so -1 is an unambiguous "final"
        -- marker) rather than one snapshot per historical week, since the
        -- save only ever exposes that season's end state, not its history.
        -- data is a JSON-encoded array (the ranked rows) rather than a
        -- normalized table - it's small (~30 rows), always read/written as a
        -- whole, and never queried by field, so JSON avoids ~30 rows of
        -- schema per snapshot for no real benefit.
        CREATE TABLE IF NOT EXISTS dynasty_top25_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            season_year INTEGER NOT NULL,
            season_week INTEGER NOT NULL,
            season_stage TEXT,
            computed_at TEXT NOT NULL,
            data TEXT NOT NULL,
            UNIQUE(user_id, season_year, season_week)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_upload_events_created ON upload_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_site_visits_visitor_date ON site_visits(visitor_id, visit_date);
        CREATE INDEX IF NOT EXISTS idx_site_visits_created ON site_visits(created_at);
        CREATE INDEX IF NOT EXISTS idx_dynasty_games_user ON dynasty_games(user_id);
        CREATE INDEX IF NOT EXISTS idx_dynasty_games_opponent ON dynasty_games(user_id, opponent_team_index);
        CREATE INDEX IF NOT EXISTS idx_top25_user_year ON dynasty_top25_snapshots(user_id, season_year, season_week);
    `);

    // Lightweight migration: CREATE TABLE IF NOT EXISTS above doesn't add
    // columns to a table that already exists from a prior deploy, and the
    // production database already has upload_events without visitor_id.
    // PRAGMA table_info lets this check safely before ALTERing, so it's a
    // no-op on every startup after the first.
    const uploadEventsColumns = db.prepare('PRAGMA table_info(upload_events)').all().map(c => c.name);
    if (!uploadEventsColumns.includes('visitor_id')) {
        db.exec('ALTER TABLE upload_events ADD COLUMN visitor_id TEXT');
    }

    return db;
}

module.exports = { getAuthDb, DB_PATH };
