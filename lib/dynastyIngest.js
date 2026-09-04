const { getAuthDb } = require('./authDb');

// Personal mode has no login at all, so there's no real user id to scope
// this data under - 0 is reserved (AUTOINCREMENT on users.id starts at 1,
// so no real account can ever collide with it) as "the one local dynasty."
const LOCAL_DYNASTY_USER_ID = 0;

/**
 * Merges one upload's worth of team/bowl/game data into the persistent
 * per-user Coaching Career tables. Safe to call on every upload - re-seeing
 * a game already on record (same season/week/opponent) just re-confirms it
 * via the UNIQUE constraint's upsert, not a duplicate. userId should be
 * req.user.id in hosted mode, or LOCAL_DYNASTY_USER_ID in personal mode
 * (see dynastyRecordsGate in server.js).
 */
function ingestDynastyRecords(userId, { teamsMeta, bowlsMeta, games }) {
    const db = getAuthDb();

    db.exec('BEGIN');
    try {
        const upsertTeam = db.prepare(`
            INSERT INTO dynasty_teams_meta (user_id, team_index, name, mascot, abbr, color_primary, color_secondary, state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, team_index) DO UPDATE SET
                name = excluded.name, mascot = excluded.mascot, abbr = excluded.abbr,
                color_primary = excluded.color_primary, color_secondary = excluded.color_secondary,
                state = excluded.state
        `);
        (teamsMeta || []).forEach(t => {
            upsertTeam.run(userId, t.teamIndex, t.name, t.mascot, t.abbr, t.colorPrimary, t.colorSecondary, t.state);
        });

        const upsertBowl = db.prepare(`
            INSERT INTO dynasty_bowls_meta (user_id, bowl_index, name)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, bowl_index) DO UPDATE SET name = excluded.name
        `);
        (bowlsMeta || []).forEach(b => {
            upsertBowl.run(userId, b.bowlIndex, b.name);
        });

        const upsertGame = db.prepare(`
            INSERT INTO dynasty_games (
                user_id, season_year, season_week, opponent_team_index, is_home,
                my_score, opp_score, result, is_bowl, is_playoff, bowl_index, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, season_year, season_week, opponent_team_index) DO UPDATE SET
                is_home = excluded.is_home, my_score = excluded.my_score, opp_score = excluded.opp_score,
                result = excluded.result, is_bowl = excluded.is_bowl, is_playoff = excluded.is_playoff,
                bowl_index = excluded.bowl_index
        `);
        let gamesUpserted = 0;
        (games || []).forEach(g => {
            upsertGame.run(
                userId, g.seasonYear, g.seasonWeek, g.opponentTeamIndex, g.isHome ? 1 : 0,
                g.myScore, g.oppScore, g.result, g.isBowl ? 1 : 0, g.isPlayoff ? 1 : 0,
                g.bowlIndex, new Date().toISOString()
            );
            gamesUpserted++;
        });

        db.exec('COMMIT');
        return { teamsUpserted: (teamsMeta || []).length, bowlsUpserted: (bowlsMeta || []).length, gamesUpserted };
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

module.exports = { ingestDynastyRecords, LOCAL_DYNASTY_USER_ID };
