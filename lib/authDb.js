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
        -- entirely in browser memory per-request, same as always.
        CREATE TABLE IF NOT EXISTS upload_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_upload_events_created ON upload_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
    `);

    return db;
}

module.exports = { getAuthDb, DB_PATH };
