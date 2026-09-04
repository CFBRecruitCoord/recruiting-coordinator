const { getAuthDb } = require('./authDb');

/**
 * Upserts one Top 25 snapshot (a specific user's specific season/week
 * position). Safe to call on every upload/refresh - re-computing the same
 * (year, week) just refreshes that snapshot's data rather than duplicating
 * it, via the UNIQUE(user_id, season_year, season_week) constraint.
 *
 * Stores every real team, not just the top 25/30 - the table is sortable by
 * several different rankings (Media/Coaches/CFP/Coordinator 25/Offense/
 * Defense poll), and a team outside the top 25 on one could easily be inside
 * it on another, so trimming at ingest time would silently break sorting by
 * anything other than whichever ranking was used to pick the cut. ~138 teams
 * of small stat fields is still only ~20-25KB of JSON per snapshot.
 */
function ingestTop25Snapshot(userId, { seasonYear, seasonWeek, seasonStage, rows }) {
    const db = getAuthDb();
    const stmt = db.prepare(`
        INSERT INTO dynasty_top25_snapshots (user_id, season_year, season_week, season_stage, computed_at, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, season_year, season_week) DO UPDATE SET
            season_stage = excluded.season_stage, computed_at = excluded.computed_at, data = excluded.data
    `);
    stmt.run(userId, seasonYear, seasonWeek, seasonStage || null, new Date().toISOString(),
        JSON.stringify(rows || []));
}

function rowToSnapshot(row) {
    if (!row) return null;
    return {
        seasonYear: row.season_year,
        seasonWeek: row.season_week,
        seasonStage: row.season_stage,
        computedAt: row.computed_at,
        rows: JSON.parse(row.data)
    };
}

function getTop25Snapshot(userId, seasonYear, seasonWeek) {
    const db = getAuthDb();
    const row = db.prepare(`
        SELECT season_year, season_week, season_stage, computed_at, data
        FROM dynasty_top25_snapshots WHERE user_id = ? AND season_year = ? AND season_week = ?
    `).get(userId, seasonYear, seasonWeek);
    return rowToSnapshot(row);
}

// "Current" = the most recent in-progress-season snapshot (season_week >= 0,
// excluding the season_week = -1 "final" sentinel rows for completed
// seasons) - what the poll should default to on load.
function getLatestTop25Snapshot(userId) {
    const db = getAuthDb();
    const row = db.prepare(`
        SELECT season_year, season_week, season_stage, computed_at, data
        FROM dynasty_top25_snapshots WHERE user_id = ? AND season_week >= 0
        ORDER BY season_year DESC, season_week DESC LIMIT 1
    `).get(userId);
    return rowToSnapshot(row);
}

// Every (year, week) this user has a snapshot for, for populating the
// historical search UI - newest first, "final" (-1) weeks sort before
// in-progress weeks of the same year so a completed season's summary reads
// naturally ahead of next season's early weeks.
function getAvailableTop25Snapshots(userId) {
    const db = getAuthDb();
    return db.prepare(`
        SELECT season_year AS seasonYear, season_week AS seasonWeek, season_stage AS seasonStage
        FROM dynasty_top25_snapshots WHERE user_id = ?
        ORDER BY season_year DESC, season_week DESC
    `).all(userId);
}

module.exports = { ingestTop25Snapshot, getTop25Snapshot, getLatestTop25Snapshot, getAvailableTop25Snapshots };
