const { getAuthDb } = require('./authDb');
const { AWARD_LABELS } = require('./parseAwards');

function teamMetaByIndex(userId) {
    const db = getAuthDb();
    const teams = db.prepare('SELECT team_index, name, mascot, abbr, color_primary, color_secondary FROM dynasty_teams_meta WHERE user_id = ?').all(userId);
    return new Map(teams.map(t => [t.team_index, {
        teamIndex: t.team_index, name: t.name, mascot: t.mascot, abbr: t.abbr,
        colorPrimary: t.color_primary, colorSecondary: t.color_secondary
    }]));
}

/**
 * Upserts every (award, year) winner from one parse. Safe to call on every
 * upload - the save re-exposes the full retained history each time, so this
 * just keeps confirming/refreshing rows that already match and adding any
 * newly-completed season, the same idempotent pattern as everything else.
 */
function ingestAwardsHistory(userId, historicalWinners) {
    const db = getAuthDb();
    const stmt = db.prepare(`
        INSERT INTO dynasty_awards_history (user_id, award_type, award_year, winner_name, winner_position, team_index, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, award_type, award_year) DO UPDATE SET
            winner_name = excluded.winner_name, winner_position = excluded.winner_position,
            team_index = excluded.team_index, computed_at = excluded.computed_at
    `);
    const now = new Date().toISOString();
    historicalWinners.forEach(w => {
        stmt.run(userId, w.awardType, w.awardYear, w.name, w.position, w.teamIndex, now);
    });
}

function ingestHeismanRace(userId, { seasonYear, seasonWeek, seasonStage, candidates }) {
    const db = getAuthDb();
    const stmt = db.prepare(`
        INSERT INTO dynasty_heisman_race_snapshots (user_id, season_year, season_week, season_stage, computed_at, data)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, season_year, season_week) DO UPDATE SET
            season_stage = excluded.season_stage, computed_at = excluded.computed_at, data = excluded.data
    `);
    stmt.run(userId, seasonYear, seasonWeek, seasonStage || null, new Date().toISOString(), JSON.stringify(candidates || []));
}

function attachTeam(row, teamMeta) {
    return { ...row, team: row.teamIndex != null ? (teamMeta.get(row.teamIndex) || null) : null };
}

// All 24 awards' winners for one year (or every year tracked, if omitted),
// each carrying its own resolved school badge.
function getAwardsHistory(userId, year) {
    const db = getAuthDb();
    const rows = year != null
        ? db.prepare('SELECT award_type AS awardType, award_year AS awardYear, winner_name AS name, winner_position AS position, team_index AS teamIndex FROM dynasty_awards_history WHERE user_id = ? AND award_year = ? ORDER BY award_type').all(userId, year)
        : db.prepare('SELECT award_type AS awardType, award_year AS awardYear, winner_name AS name, winner_position AS position, team_index AS teamIndex FROM dynasty_awards_history WHERE user_id = ? ORDER BY award_year DESC, award_type').all(userId);
    const teamMeta = teamMetaByIndex(userId);
    return rows.map(r => ({ ...attachTeam(r, teamMeta), awardLabel: AWARD_LABELS[r.awardType] || r.awardType }));
}

function getAvailableAwardYears(userId) {
    const db = getAuthDb();
    return db.prepare('SELECT DISTINCT award_year AS year FROM dynasty_awards_history WHERE user_id = ? ORDER BY year DESC').all(userId).map(r => r.year);
}

/**
 * Every school with at least one award win, sorted by total wins - each
 * carrying a per-award-type breakdown for the drill-down view. Computed on
 * read from dynasty_awards_history rather than kept as a running tally,
 * since a coaching career's worth of award rows (a few hundred at most) is
 * cheap to fold over every time.
 */
function getSchoolAwardTotals(userId) {
    const db = getAuthDb();
    const rows = db.prepare('SELECT team_index AS teamIndex, award_type AS awardType, award_year AS awardYear, winner_name AS name, winner_position AS position FROM dynasty_awards_history WHERE user_id = ? AND team_index IS NOT NULL').all(userId);
    const teamMeta = teamMetaByIndex(userId);

    const byTeam = new Map();
    rows.forEach(r => {
        if (!byTeam.has(r.teamIndex)) byTeam.set(r.teamIndex, []);
        byTeam.get(r.teamIndex).push({ awardType: r.awardType, awardLabel: AWARD_LABELS[r.awardType] || r.awardType, awardYear: r.awardYear, name: r.name, position: r.position });
    });

    const result = [];
    byTeam.forEach((wins, teamIndex) => {
        const byAward = new Map();
        wins.forEach(w => byAward.set(w.awardLabel, (byAward.get(w.awardLabel) || 0) + 1));
        result.push({
            team: teamMeta.get(teamIndex) || { teamIndex, name: `Team #${teamIndex}` },
            totalWins: wins.length,
            breakdown: [...byAward.entries()].map(([awardLabel, count]) => ({ awardLabel, count })).sort((a, b) => b.count - a.count),
            wins: wins.sort((a, b) => b.awardYear - a.awardYear)
        });
    });
    return result.sort((a, b) => b.totalWins - a.totalWins);
}

function rowToHeismanSnapshot(row, userId) {
    if (!row) return null;
    const teamMeta = teamMetaByIndex(userId);
    return {
        seasonYear: row.season_year, seasonWeek: row.season_week, seasonStage: row.season_stage,
        candidates: JSON.parse(row.data).map(c => attachTeam(c, teamMeta))
    };
}

function getHeismanRace(userId, seasonYear, seasonWeek) {
    const db = getAuthDb();
    const row = db.prepare('SELECT * FROM dynasty_heisman_race_snapshots WHERE user_id = ? AND season_year = ? AND season_week = ?').get(userId, seasonYear, seasonWeek);
    return rowToHeismanSnapshot(row, userId);
}

function getLatestHeismanRace(userId) {
    const db = getAuthDb();
    const row = db.prepare('SELECT * FROM dynasty_heisman_race_snapshots WHERE user_id = ? AND season_week >= 0 ORDER BY season_year DESC, season_week DESC LIMIT 1').get(userId);
    return rowToHeismanSnapshot(row, userId);
}

function getAvailableHeismanWeeks(userId) {
    const db = getAuthDb();
    return db.prepare('SELECT season_year AS seasonYear, season_week AS seasonWeek, season_stage AS seasonStage FROM dynasty_heisman_race_snapshots WHERE user_id = ? ORDER BY season_year DESC, season_week DESC').all(userId);
}

module.exports = {
    ingestAwardsHistory, ingestHeismanRace,
    getAwardsHistory, getAvailableAwardYears, getSchoolAwardTotals,
    getHeismanRace, getLatestHeismanRace, getAvailableHeismanWeeks
};
