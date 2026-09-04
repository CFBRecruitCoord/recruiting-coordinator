const { getAuthDb } = require('./authDb');

function teamMetaByIndex(userId) {
    const db = getAuthDb();
    const teams = db.prepare('SELECT team_index, name, mascot, abbr, color_primary, color_secondary FROM dynasty_teams_meta WHERE user_id = ?').all(userId);
    return new Map(teams.map(t => [t.team_index, {
        teamIndex: t.team_index, name: t.name, mascot: t.mascot, abbr: t.abbr,
        colorPrimary: t.color_primary, colorSecondary: t.color_secondary
    }]));
}

/**
 * Upserts every 1st/2nd Team selection from one parse. Safe to call every
 * upload - PlayerAward's short/inconsistent retention (see schema comment
 * in lib/authDb.js) means this is what actually builds up a real multi-year
 * history here, more so than for the other awards.
 */
function ingestAllAmericans(userId, selections) {
    const db = getAuthDb();
    const stmt = db.prepare(`
        INSERT INTO dynasty_all_american_selections (user_id, scope, team, year, player_key, player_name, position, team_index, conference, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, scope, team, year, player_key) DO UPDATE SET
            player_name = excluded.player_name, position = excluded.position,
            team_index = excluded.team_index, conference = excluded.conference, computed_at = excluded.computed_at
    `);
    const now = new Date().toISOString();
    selections.forEach(s => {
        const playerKey = [s.name, s.position, s.teamIndex].join('|');
        stmt.run(userId, s.scope, s.team, s.year, playerKey, s.name, s.position, s.teamIndex, s.conference, now);
    });
}

function attachTeam(row, teamMeta) {
    return { ...row, team: row.teamIndex != null ? (teamMeta.get(row.teamIndex) || null) : null };
}

/**
 * One year's 1st/2nd Team rosters. scope 'national' ignores conference;
 * scope 'conference' requires one. Returns { year, firstTeam, secondTeam },
 * each a plain array of selections (position/player/school) - genuinely
 * sparse for the national scope some years, which is left as-is rather than
 * padded out, since that's honestly what the save tracks.
 */
function getAllAmericanTeam(userId, scope, year, conference) {
    const db = getAuthDb();
    const rows = scope === 'conference'
        ? db.prepare('SELECT * FROM dynasty_all_american_selections WHERE user_id = ? AND scope = ? AND year = ? AND conference = ?').all(userId, scope, year, conference)
        : db.prepare('SELECT * FROM dynasty_all_american_selections WHERE user_id = ? AND scope = ? AND year = ?').all(userId, scope, year);

    const teamMeta = teamMetaByIndex(userId);
    const mapped = rows.map(r => attachTeam({ name: r.player_name, position: r.position, teamIndex: r.team_index, conference: r.conference }, teamMeta));
    return {
        year,
        firstTeam: mapped.filter((_, i) => rows[i].team === '1st').sort((a, b) => (a.position || '').localeCompare(b.position || '')),
        secondTeam: mapped.filter((_, i) => rows[i].team === '2nd').sort((a, b) => (a.position || '').localeCompare(b.position || ''))
    };
}

function getAvailableAllAmericanYears(userId, scope) {
    const db = getAuthDb();
    return db.prepare('SELECT DISTINCT year FROM dynasty_all_american_selections WHERE user_id = ? AND scope = ? ORDER BY year DESC').all(userId, scope).map(r => r.year);
}

function getAllAmericanConferences(userId) {
    const db = getAuthDb();
    return db.prepare("SELECT DISTINCT conference FROM dynasty_all_american_selections WHERE user_id = ? AND scope = 'conference' AND conference IS NOT NULL ORDER BY conference").all(userId).map(r => r.conference);
}

/**
 * Schools ranked by total 1st+2nd Team selections for one scope, each
 * carrying a 1st-vs-2nd breakdown plus the full list of selections for
 * drill-down - same shape/reasoning as getSchoolAwardTotals in
 * lib/awardsIngest.js.
 */
function getAllAmericanSchoolTotals(userId, scope) {
    const db = getAuthDb();
    const rows = db.prepare('SELECT team_index AS teamIndex, team, year, player_name AS name, position FROM dynasty_all_american_selections WHERE user_id = ? AND scope = ? AND team_index IS NOT NULL').all(userId, scope);
    const teamMeta = teamMetaByIndex(userId);

    const byTeam = new Map();
    rows.forEach(r => {
        if (!byTeam.has(r.teamIndex)) byTeam.set(r.teamIndex, []);
        byTeam.get(r.teamIndex).push({ team: r.team, year: r.year, name: r.name, position: r.position });
    });

    const result = [];
    byTeam.forEach((selections, teamIndex) => {
        const firstCount = selections.filter(s => s.team === '1st').length;
        const secondCount = selections.filter(s => s.team === '2nd').length;
        result.push({
            team: teamMeta.get(teamIndex) || { teamIndex, name: `Team #${teamIndex}` },
            totalSelections: selections.length,
            firstTeamCount: firstCount,
            secondTeamCount: secondCount,
            selections: selections.sort((a, b) => b.year - a.year)
        });
    });
    return result.sort((a, b) => b.totalSelections - a.totalSelections);
}

module.exports = {
    ingestAllAmericans, getAllAmericanTeam, getAvailableAllAmericanYears,
    getAllAmericanConferences, getAllAmericanSchoolTotals
};
