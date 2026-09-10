const { getAuthDb } = require('./authDb');

/** Upserts every conference's championship result from one parse. */
function ingestConferenceChampionships(userId, results) {
    const db = getAuthDb();
    const stmt = db.prepare(`
        INSERT INTO dynasty_conference_championships (user_id, year, conference, winner_team_index, winner_score, loser_team_index, loser_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, year, conference) DO UPDATE SET
            winner_team_index = excluded.winner_team_index, winner_score = excluded.winner_score,
            loser_team_index = excluded.loser_team_index, loser_score = excluded.loser_score,
            computed_at = excluded.computed_at
    `);
    const now = new Date().toISOString();
    results.forEach(r => {
        stmt.run(userId, r.year, r.conference, r.winnerTeamIndex, r.winnerScore, r.loserTeamIndex, r.loserScore, now);
    });
}

// Every conference championship game the given team_index played in (won or
// lost), across all tracked years - used to score a coach's own tenure
// against this national table.
function getConferenceChampionshipsForTeam(userId, teamIndex) {
    const db = getAuthDb();
    return db.prepare(`
        SELECT year, conference, winner_team_index AS winnerTeamIndex, winner_score AS winnerScore,
               loser_team_index AS loserTeamIndex, loser_score AS loserScore
        FROM dynasty_conference_championships
        WHERE user_id = ? AND (winner_team_index = ? OR loser_team_index = ?)
        ORDER BY year DESC
    `).all(userId, teamIndex, teamIndex);
}

module.exports = { ingestConferenceChampionships, getConferenceChampionshipsForTeam };
