const { getAuthDb } = require('./authDb');

/** Upserts which school the user coached in one dynasty year. */
function ingestCoachTenure(userId, year, teamIndex) {
    const db = getAuthDb();
    db.prepare(`
        INSERT INTO dynasty_coach_tenure (user_id, year, team_index, computed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, year) DO UPDATE SET team_index = excluded.team_index, computed_at = excluded.computed_at
    `).run(userId, year, teamIndex, new Date().toISOString());
}

// Every (year -> team) the user has ever coached, oldest first.
function getCoachTenureByYear(userId) {
    const db = getAuthDb();
    return db.prepare('SELECT year, team_index AS teamIndex FROM dynasty_coach_tenure WHERE user_id = ? ORDER BY year ASC').all(userId);
}

/**
 * Collapses the year-by-year tenure into contiguous blocks per school (e.g.
 * years 0-3 at Baylor, 4-6 at Texas) for the timeline display - a coach who
 * changes jobs and years without a captured upload in between still gets a
 * sensible block boundary wherever the team actually changes.
 */
function getCoachTenureTimeline(userId) {
    const rows = getCoachTenureByYear(userId);
    const blocks = [];
    rows.forEach(r => {
        const last = blocks[blocks.length - 1];
        if (last && last.teamIndex === r.teamIndex && r.year === last.endYear + 1) {
            last.endYear = r.year;
        } else {
            blocks.push({ teamIndex: r.teamIndex, startYear: r.year, endYear: r.year });
        }
    });
    return blocks;
}

module.exports = { ingestCoachTenure, getCoachTenureByYear, getCoachTenureTimeline };
