const { getAuthDb } = require('./authDb');

function emptyRecord() {
    return {
        wins: 0, losses: 0, ties: 0,
        homeWins: 0, homeLosses: 0, homeTies: 0,
        awayWins: 0, awayLosses: 0, awayTies: 0,
        lastWinYear: null, lastWinWeek: null,
        // Specifically the most recent WIN ON THE ROAD (played at the
        // opponent's venue) - "the season you last won a game at that
        // school," as opposed to lastWinYear/Week above which is the most
        // recent win regardless of site.
        lastAwayWinYear: null, lastAwayWinWeek: null,
        biggestWin: null, // { year, week, myScore, oppScore, margin, opponentTeamIndex }
        worstLoss: null,
        gamesPlayed: 0
    };
}

/**
 * Folds a list of game rows (from dynasty_games) into one W-L-T summary,
 * tracking home/away splits, the most recent win overall, the most recent
 * road win specifically, and the largest-margin win and loss.
 */
function summarizeGames(games) {
    const rec = emptyRecord();
    games.forEach(g => {
        rec.gamesPlayed++;
        const margin = g.my_score - g.opp_score;

        if (g.result === 'W') {
            rec.wins++;
            if (g.is_home) rec.homeWins++; else rec.awayWins++;
            if (rec.lastWinYear == null || g.season_year > rec.lastWinYear ||
                (g.season_year === rec.lastWinYear && g.season_week > rec.lastWinWeek)) {
                rec.lastWinYear = g.season_year;
                rec.lastWinWeek = g.season_week;
            }
            if (!g.is_home && (rec.lastAwayWinYear == null || g.season_year > rec.lastAwayWinYear ||
                (g.season_year === rec.lastAwayWinYear && g.season_week > rec.lastAwayWinWeek))) {
                rec.lastAwayWinYear = g.season_year;
                rec.lastAwayWinWeek = g.season_week;
            }
            if (!rec.biggestWin || margin > rec.biggestWin.margin) {
                rec.biggestWin = {
                    year: g.season_year, week: g.season_week,
                    myScore: g.my_score, oppScore: g.opp_score, margin,
                    opponentTeamIndex: g.opponent_team_index
                };
            }
        } else if (g.result === 'L') {
            rec.losses++;
            if (g.is_home) rec.homeLosses++; else rec.awayLosses++;
            if (!rec.worstLoss || margin < rec.worstLoss.margin) {
                rec.worstLoss = {
                    year: g.season_year, week: g.season_week,
                    myScore: g.my_score, oppScore: g.opp_score, margin,
                    opponentTeamIndex: g.opponent_team_index
                };
            }
        } else {
            rec.ties++;
            if (g.is_home) rec.homeTies++; else rec.awayTies++;
        }
    });
    return rec;
}

// Per-school record: one row per real opponent school, win-loss history
// against them specifically (built from the user's own accumulated
// dynasty_games log).
function getSchoolRecords(userId) {
    const db = getAuthDb();
    const teams = db.prepare('SELECT * FROM dynasty_teams_meta WHERE user_id = ? ORDER BY name').all(userId);
    const games = db.prepare('SELECT * FROM dynasty_games WHERE user_id = ?').all(userId);

    const gamesByOpponent = new Map();
    games.forEach(g => {
        if (!gamesByOpponent.has(g.opponent_team_index)) gamesByOpponent.set(g.opponent_team_index, []);
        gamesByOpponent.get(g.opponent_team_index).push(g);
    });

    const teamNameByIndex = new Map(teams.map(t => [t.team_index, t.name]));

    return teams.map(team => {
        const teamGames = gamesByOpponent.get(team.team_index) || [];
        const summary = summarizeGames(teamGames);
        return {
            teamIndex: team.team_index,
            name: team.name,
            mascot: team.mascot,
            abbr: team.abbr,
            colorPrimary: team.color_primary,
            colorSecondary: team.color_secondary,
            state: team.state,
            ...summary
        };
    }).map(r => attachOpponentNames(r, teamNameByIndex));
}

function attachOpponentNames(record, teamNameByIndex) {
    if (record.biggestWin) {
        record.biggestWin = { ...record.biggestWin, opponentName: teamNameByIndex.get(record.biggestWin.opponentTeamIndex) || null };
    }
    if (record.worstLoss) {
        record.worstLoss = { ...record.worstLoss, opponentName: teamNameByIndex.get(record.worstLoss.opponentTeamIndex) || null };
    }
    return record;
}

// A single aggregate record (not one row per opponent) for all bowl games, or
// all playoff games. Distinguishing the two relies on the BowlGame record's
// own IsPlayoffBowl flag (see parseSchoolRecords.js) since both categories
// are hosted at "bowl sites" in the underlying data.
function getAggregateRecord(userId, whereColumn) {
    const db = getAuthDb();
    const teams = db.prepare('SELECT team_index, name FROM dynasty_teams_meta WHERE user_id = ?').all(userId);
    const teamNameByIndex = new Map(teams.map(t => [t.team_index, t.name]));

    const games = db.prepare(`SELECT * FROM dynasty_games WHERE user_id = ? AND ${whereColumn} = 1`).all(userId);
    const summary = summarizeGames(games);
    return attachOpponentNames(summary, teamNameByIndex);
}

function getBowlRecord(userId) {
    return getAggregateRecord(userId, 'is_bowl');
}

function getPlayoffRecord(userId) {
    return getAggregateRecord(userId, 'is_playoff');
}

// Per-bowl-game record: one row per real bowl (Sugar Bowl, Rose Bowl, etc.),
// including bowls never played yet (shown with a 0-0 record) - built from the
// save's full fixed bowl reference list (dynasty_bowls_meta), not just the
// ones seen in the game log so far.
function getBowlRecordsByName(userId) {
    const db = getAuthDb();
    const bowls = db.prepare('SELECT * FROM dynasty_bowls_meta WHERE user_id = ? ORDER BY name').all(userId);
    const teams = db.prepare('SELECT team_index, name FROM dynasty_teams_meta WHERE user_id = ?').all(userId);
    const teamNameByIndex = new Map(teams.map(t => [t.team_index, t.name]));

    const games = db.prepare('SELECT * FROM dynasty_games WHERE user_id = ? AND is_bowl = 1 AND bowl_index IS NOT NULL').all(userId);
    const gamesByBowl = new Map();
    games.forEach(g => {
        if (!gamesByBowl.has(g.bowl_index)) gamesByBowl.set(g.bowl_index, []);
        gamesByBowl.get(g.bowl_index).push(g);
    });

    return bowls.map(bowl => {
        const bowlGames = gamesByBowl.get(bowl.bowl_index) || [];
        const summary = summarizeGames(bowlGames);
        return attachOpponentNames({ bowlIndex: bowl.bowl_index, name: bowl.name, ...summary }, teamNameByIndex);
    });
}

module.exports = { getSchoolRecords, getBowlRecord, getPlayoffRecord, getBowlRecordsByName };
