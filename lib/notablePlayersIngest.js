const { getAuthDb } = require('./authDb');

/**
 * Upserts the user's current starters into their all-time notable-players
 * list. peak_overall only ever ratchets upward (a player having a down
 * stretch shouldn't erase their career-best rating); stats are simply
 * replaced with the latest read since the save's own career totals are
 * already cumulative and monotonic while a player stays on this roster.
 */
function ingestNotablePlayers(userId, teamIndex, players) {
    const db = getAuthDb();
    const getExisting = db.prepare('SELECT peak_overall AS peakOverall FROM dynasty_notable_players WHERE user_id = ? AND player_key = ?');
    const upsert = db.prepare(`
        INSERT INTO dynasty_notable_players (user_id, player_key, name, position, team_index, peak_overall, last_school_year, stats, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, player_key) DO UPDATE SET
            name = excluded.name, position = excluded.position, team_index = excluded.team_index,
            peak_overall = excluded.peak_overall, last_school_year = excluded.last_school_year,
            stats = excluded.stats, updated_at = excluded.updated_at
    `);

    players.forEach(p => {
        if (!p.playerKey) return; // no stable id to key on - skip rather than risk overwriting someone else's row
        const existing = getExisting.get(userId, p.playerKey);
        const peakOverall = existing ? Math.max(existing.peakOverall, p.overall) : p.overall;
        upsert.run(userId, p.playerKey, p.name, p.position, teamIndex, peakOverall, p.schoolYear, JSON.stringify(p.stats || {}), new Date().toISOString());
    });
}

function teamMetaByIndex(userId) {
    const db = getAuthDb();
    const teams = db.prepare('SELECT team_index, name, mascot, abbr, color_primary, color_secondary FROM dynasty_teams_meta WHERE user_id = ?').all(userId);
    return new Map(teams.map(t => [t.team_index, {
        teamIndex: t.team_index, name: t.name, mascot: t.mascot, abbr: t.abbr,
        colorPrimary: t.color_primary, colorSecondary: t.color_secondary
    }]));
}

// teamIndex is optional - omit for every school this coach has been at.
function getNotablePlayers(userId, teamIndex) {
    const db = getAuthDb();
    const rows = teamIndex != null
        ? db.prepare('SELECT * FROM dynasty_notable_players WHERE user_id = ? AND team_index = ? ORDER BY peak_overall DESC').all(userId, teamIndex)
        : db.prepare('SELECT * FROM dynasty_notable_players WHERE user_id = ? ORDER BY peak_overall DESC').all(userId);
    const teamMeta = teamMetaByIndex(userId);
    return rows.map(row => ({
        name: row.name,
        position: row.position,
        team: teamMeta.get(row.team_index) || null,
        overall: row.peak_overall,
        schoolYear: row.last_school_year,
        stats: JSON.parse(row.stats || '{}')
    }));
}

// Every school this coach has had a notable player at, for the school
// filter dropdown - same derive-from-own-data approach as
// getRecruitingSchools in lib/recruitingClassIngest.js.
function getNotablePlayerSchools(userId) {
    const db = getAuthDb();
    const teamMeta = teamMetaByIndex(userId);
    const rows = db.prepare('SELECT DISTINCT team_index FROM dynasty_notable_players WHERE user_id = ?').all(userId);
    return rows
        .map(r => teamMeta.get(r.team_index) || { teamIndex: r.team_index, name: `Team #${r.team_index}` })
        .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { ingestNotablePlayers, getNotablePlayers, getNotablePlayerSchools };
