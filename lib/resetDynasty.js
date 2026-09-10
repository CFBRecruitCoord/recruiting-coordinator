const { getAuthDb } = require('./authDb');

// Every table that accumulates per-dynasty history across uploads (see
// lib/authDb.js). Deliberately NOT touching users/sessions (the account
// itself), upload_events/feedback/site_visits (admin-facing usage
// analytics, not dynasty state), or Coordinator Settings (recruiting
// preferences, stored client-side in localStorage, not the server DB at
// all) - "start a new dynasty" only means the accumulated history tables.
const DYNASTY_TABLES = [
    'dynasty_teams_meta',
    'dynasty_bowls_meta',
    'dynasty_games',
    'dynasty_top25_snapshots',
    'dynasty_recruiting_classes',
    'dynasty_notable_players',
    'dynasty_awards_history',
    'dynasty_heisman_race_snapshots',
    'dynasty_all_american_selections',
    'dynasty_coach_tenure',
    'dynasty_conference_championships'
];

/**
 * Permanently deletes every row of accumulated dynasty history for one
 * user (or the personal-mode sentinel) - the "start a new dynasty" reset.
 * Table names are a fixed internal list, never user input, so building the
 * DELETE statement with string interpolation here is safe (no injection
 * surface - contrast with the ? placeholders used for the actual userId
 * value, which is the only real external input).
 */
function resetDynastyData(userId) {
    const db = getAuthDb();
    db.exec('BEGIN');
    try {
        DYNASTY_TABLES.forEach(table => {
            db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
        });
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

module.exports = { resetDynastyData, DYNASTY_TABLES };
