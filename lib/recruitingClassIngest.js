const { getAuthDb } = require('./authDb');

const BLUE_CHIP_MIN_STARS = 4;

/**
 * Upserts one dynasty year's recruiting class summary for a user, computed
 * from their current roster's true Freshmen (see the schema comment in
 * lib/authDb.js for why this - rather than the recruiting board - is the
 * source of truth). Safe to call on every upload: re-ingesting the same
 * class_year just refreshes it with whatever's currently on the roster,
 * which is exactly right both mid-cycle (still filling in) and after the
 * class has fully aged past Freshman (stops changing - the final state).
 * teamIndex is whichever school the coach was actually at when this class
 * signed - re-ingesting a year under a NEW team_index (after a coaching
 * change) correctly re-attributes that one year's row to the new school,
 * rather than leaving it stuck with wherever the coach signed it from.
 */
function ingestRecruitingClass(userId, { classYear, teamIndex, signees }) {
    const db = getAuthDb();
    const starred = signees.filter(s => s.stars);
    const avgStars = starred.length ? starred.reduce((sum, s) => sum + s.stars, 0) / starred.length : null;
    const blueChipCount = starred.filter(s => s.stars >= BLUE_CHIP_MIN_STARS).length;

    const stmt = db.prepare(`
        INSERT INTO dynasty_recruiting_classes (user_id, class_year, team_index, computed_at, signee_count, avg_stars, blue_chip_count, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, class_year) DO UPDATE SET
            team_index = excluded.team_index, computed_at = excluded.computed_at, signee_count = excluded.signee_count,
            avg_stars = excluded.avg_stars, blue_chip_count = excluded.blue_chip_count, data = excluded.data
    `);
    stmt.run(userId, classYear, teamIndex, new Date().toISOString(), signees.length, avgStars, blueChipCount, JSON.stringify(signees));
}

function teamMetaByIndex(userId) {
    const db = getAuthDb();
    const teams = db.prepare('SELECT team_index, name, mascot, abbr, color_primary, color_secondary FROM dynasty_teams_meta WHERE user_id = ?').all(userId);
    return new Map(teams.map(t => [t.team_index, {
        teamIndex: t.team_index, name: t.name, mascot: t.mascot, abbr: t.abbr,
        colorPrimary: t.color_primary, colorSecondary: t.color_secondary
    }]));
}

// Every school this coach has actually signed a class at, for the school
// filter dropdown - derived from their own class history rather than
// tracked separately, since it's exactly the same set by definition.
function getRecruitingSchools(userId) {
    const db = getAuthDb();
    const teamMeta = teamMetaByIndex(userId);
    const rows = db.prepare('SELECT DISTINCT team_index FROM dynasty_recruiting_classes WHERE user_id = ? AND team_index >= 0').all(userId);
    return rows
        .map(r => teamMeta.get(r.team_index) || { teamIndex: r.team_index, name: `Team #${r.team_index}` })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function rowsForUser(userId, teamIndex) {
    const db = getAuthDb();
    const rows = teamIndex != null
        ? db.prepare('SELECT * FROM dynasty_recruiting_classes WHERE user_id = ? AND team_index = ? ORDER BY class_year DESC').all(userId, teamIndex)
        : db.prepare('SELECT * FROM dynasty_recruiting_classes WHERE user_id = ? ORDER BY class_year DESC').all(userId);
    const teamMeta = teamMetaByIndex(userId);
    return rows.map(row => ({
        classYear: row.class_year,
        team: teamMeta.get(row.team_index) || null,
        computedAt: row.computed_at,
        signeeCount: row.signee_count,
        avgStars: row.avg_stars,
        blueChipCount: row.blue_chip_count,
        signees: JSON.parse(row.data)
    }));
}

// teamIndex is optional - omit for the coach's whole career across every
// school they've been at, or pass one to scope to a single school.
function getRecruitingClasses(userId, teamIndex) {
    return rowsForUser(userId, teamIndex);
}

/**
 * Career (or single-school) recruiting totals: signee count, career average
 * star rating, blue-chip (4-5 star) count, and the highest-overall signees
 * ever landed - all computed on read from the same per-year rows rather
 * than kept as a separately-maintained running total, since the year rows
 * are already the full source of truth and this is cheap to fold over (a
 * coaching career is, at most, a few dozen rows).
 */
function getRecruitingCareerSummary(userId, teamIndex, topSigneeLimit) {
    const rows = rowsForUser(userId, teamIndex);
    const allSignees = rows.flatMap(r => r.signees.map(s => ({ ...s, classYear: r.classYear, team: r.team })));
    const starred = allSignees.filter(s => s.stars);

    const topSignees = [...allSignees]
        .filter(s => s.overall != null)
        .sort((a, b) => b.overall - a.overall)
        .slice(0, topSigneeLimit || 25);

    return {
        classYearsTracked: rows.length,
        signeeCount: allSignees.length,
        avgStars: starred.length ? starred.reduce((sum, s) => sum + s.stars, 0) / starred.length : null,
        blueChipCount: starred.filter(s => s.stars >= BLUE_CHIP_MIN_STARS).length,
        topSignees
    };
}

module.exports = { ingestRecruitingClass, getRecruitingClasses, getRecruitingCareerSummary, getRecruitingSchools };
