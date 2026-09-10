const { getAuthDb } = require('./authDb');
const { getCoachTenureTimeline } = require('./coachTenureIngest');
const { getConferenceChampionshipsForTeam } = require('./conferenceChampionshipsIngest');
const { AWARD_LABELS } = require('./parseAwards');

function teamMetaByIndex(userId) {
    const db = getAuthDb();
    const teams = db.prepare('SELECT team_index, name, mascot, abbr, color_primary, color_secondary FROM dynasty_teams_meta WHERE user_id = ?').all(userId);
    return new Map(teams.map(t => [t.team_index, {
        teamIndex: t.team_index, name: t.name, mascot: t.mascot, abbr: t.abbr,
        colorPrimary: t.color_primary, colorSecondary: t.color_secondary
    }]));
}

function record(wins, losses, ties) {
    return { wins, losses, ties, games: wins + losses + ties };
}

/**
 * Folds every tracked table into one career summary for the Coaching Career
 * banner: the tenure timeline (every school coached + years), win-loss
 * records (overall/conference/bowl/playoff/national championship - all
 * straight from dynasty_games, which is already scoped to just the user's
 * own games), conference championship game record, and counts of
 * All-Americans/awards produced *while coaching* - the latter two are
 * national-scope tables (every school's honors), so they're filtered here to
 * just the (team_index, year) pairs the tenure timeline says were actually
 * this coach's, rather than counting another school's honors a team_index
 * happened to match outside the coach's own years there.
 */
function getCoachCareerSummary(userId) {
    const db = getAuthDb();
    const teamMeta = teamMetaByIndex(userId);
    const timeline = getCoachTenureTimeline(userId);

    if (!timeline.length) {
        return {
            hasData: false, currentTeam: null, timeline: [],
            overall: record(0, 0, 0), conference: record(0, 0, 0), bowl: record(0, 0, 0),
            playoff: record(0, 0, 0), nationalChampionships: { wins: 0, appearances: 0 },
            conferenceChampionships: { wins: 0, appearances: 0 },
            allAmericans: { first: 0, second: 0, freshman: 0 },
            awardCount: 0, headCoachOfYearCount: 0
        };
    }

    const timelineWithTeams = timeline.map(t => ({ ...t, team: teamMeta.get(t.teamIndex) || null }));
    const currentTeamIndex = timeline[timeline.length - 1].teamIndex;
    const tenureSet = new Set(timeline.map(t => t.teamIndex)); // every school ever coached, for a fast membership check
    const tenureYearTeam = new Set(); // "year|teamIndex" pairs actually coached, for precise scoping
    timeline.forEach(block => {
        for (let y = block.startYear; y <= block.endYear; y++) tenureYearTeam.add(`${y}|${block.teamIndex}`);
    });

    // ---- Game-log-derived records (dynasty_games is already just my games) ----
    const games = db.prepare('SELECT result, is_bowl AS isBowl, is_playoff AS isPlayoff, is_conference AS isConference, is_national_championship AS isNc FROM dynasty_games WHERE user_id = ?').all(userId);
    const tally = (filterFn) => {
        const filtered = filterFn ? games.filter(filterFn) : games;
        return record(
            filtered.filter(g => g.result === 'W').length,
            filtered.filter(g => g.result === 'L').length,
            filtered.filter(g => g.result === 'T').length
        );
    };
    const overall = tally(null);
    const conference = tally(g => g.isConference);
    const bowl = tally(g => g.isBowl);
    const playoff = tally(g => g.isPlayoff);
    const ncGames = games.filter(g => g.isNc);
    const nationalChampionships = { wins: ncGames.filter(g => g.result === 'W').length, appearances: ncGames.length };

    // ---- Conference championship game record (any school ever coached) ----
    let confChampWins = 0, confChampAppearances = 0;
    tenureSet.forEach(teamIndex => {
        getConferenceChampionshipsForTeam(userId, teamIndex).forEach(g => {
            if (!tenureYearTeam.has(`${g.year}|${teamIndex}`)) return; // played for someone else that year
            confChampAppearances++;
            if (g.winnerTeamIndex === teamIndex) confChampWins++;
        });
    });
    const conferenceChampionships = { wins: confChampWins, appearances: confChampAppearances };

    // ---- All-Americans coached (national scope only - conference honors
    // aren't part of "All-American" in the usual sense) ----
    const allAmRows = db.prepare("SELECT year, team_index AS teamIndex, team FROM dynasty_all_american_selections WHERE user_id = ? AND scope = 'national'").all(userId);
    const myAllAm = allAmRows.filter(r => tenureYearTeam.has(`${r.year}|${r.teamIndex}`));
    const allAmericans = {
        first: myAllAm.filter(r => r.team === '1st').length,
        second: myAllAm.filter(r => r.team === '2nd').length,
        freshman: myAllAm.filter(r => r.team === 'fr').length
    };

    // ---- Awards won while coaching (players' awards + personal Best Head
    // Coach honors) ----
    const awardRows = db.prepare('SELECT award_year AS awardYear, team_index AS teamIndex, award_type AS awardType FROM dynasty_awards_history WHERE user_id = ?').all(userId);
    const myAwards = awardRows.filter(r => tenureYearTeam.has(`${r.awardYear}|${r.teamIndex}`));
    const awardCount = myAwards.length;
    const headCoachOfYearCount = myAwards.filter(r => r.awardType === 'BEST_HC').length;

    return {
        hasData: true,
        currentTeam: teamMeta.get(currentTeamIndex) || null,
        timeline: timelineWithTeams,
        overall, conference, bowl, playoff,
        nationalChampionships, conferenceChampionships,
        allAmericans, awardCount, headCoachOfYearCount
    };
}

module.exports = { getCoachCareerSummary };
