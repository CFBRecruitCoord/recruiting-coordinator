const { utilService } = require('madden-franchise');
const { TEAM_STATE_BY_NAME } = require('./teamStates');

const NOT_A_REAL_TEAM_INDEX = 255; // shared placeholder index used by generic "FCS" filler teams

function toHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0')).join('');
}

function getMainTeamTable(franchise) {
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    return teamTables.find(t => t.header && t.header.recordCapacity >= 100);
}

// Tables shared by every team's TeamSeasonStats reference chain - read once
// per parse (via the caller-supplied cache object) and reused across all
// ~130 teams rather than per-team, since readRecords() parses the whole
// table each time. Deliberately NOT a module-level cache: each call to
// parseNationalTeamStats works against its own franchise file (a different
// upload/refresh request), so caching across calls would leak stale table
// references from a previous request's franchise object.
async function resolveSeasonStatsSlots(franchise, teamRecord, cache) {
    const arrRef = utilService.getReferenceData(teamRecord.TeamSeasonStats);
    if (!cache.arrTable) {
        cache.arrTable = franchise.getTableById(arrRef.tableId);
        await cache.arrTable.readRecords();
    }
    const arrRec = cache.arrTable.records[arrRef.rowNumber];

    if (!cache.statsTable) {
        cache.statsTable = franchise.tables.find(t => t.name === 'TeamStats');
        await cache.statsTable.readRecords();
    }

    const slots = [];
    for (let i = 0; i < 5; i++) {
        try {
            const ref = utilService.getReferenceData(arrRec['TeamStats' + i]);
            const rec = cache.statsTable.records[ref.rowNumber];
            slots.push(rec && !rec.isEmpty ? rec : null);
        } catch (e) {
            slots.push(null);
        }
    }
    return slots;
}

function statsRowToStatLine(rec) {
    if (!rec) return null;
    return {
        wins: rec.WINS || 0, losses: rec.LOSSES || 0, ties: rec.TIES || 0,
        gamesPlayed: (rec.WINS || 0) + (rec.LOSSES || 0) + (rec.TIES || 0),
        offYards: rec.OFFYARDS || 0, offPassYards: rec.OFFPASSYARDS || 0, offRushYards: rec.OFFRUSHYARDS || 0,
        defPassYards: rec.DEFPASSYARDS || 0, defRushYards: rec.DEFRUSHYARDS || 0,
        sacks: rec.SACKS || 0, defInts: rec.DEFINTS || 0, fumbleRec: rec.FUMBLEREC || 0,
        passTDs: rec.PASSTDS || 0, rushTDs: rec.RUSHTDS || 0
    };
}

/**
 * Reads every real school's national-scope team stats for the Top 25 Poll:
 * the CURRENT season (live, in-progress - TeamSeasonStats slot 0) plus the
 * last up-to-4 COMPLETED seasons (slots 1-4), each keyed to its real dynasty
 * year via seasonYear - i. Points for/against and roster ratings (used for
 * the "preseason, no games played yet" projection) only exist on the Team
 * record itself for the CURRENT season - the save doesn't retain a
 * per-season points history the way it does yards/TDs/turnovers via
 * TeamStats, so historical completed seasons omit points.
 */
async function parseNationalTeamStats(franchise) {
    const seasonInfoTable = franchise.tables.filter(t => t.name === 'SeasonInfo')[0];
    await seasonInfoTable.readRecords();
    const seasonInfo = seasonInfoTable.records.find(r => !r.isEmpty);
    const currentYear = seasonInfo.CurrentYear;
    const currentWeek = seasonInfo.CurrentWeek;
    const currentStage = seasonInfo.CurrentStage;

    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    const currentTeams = [];
    const historicalByYear = new Map(); // year -> teams[]
    const statsCache = {};

    for (const r of teamTable.records) {
        if (r.isEmpty || !r.DisplayName) continue;
        if (r.TeamIndex === NOT_A_REAL_TEAM_INDEX) continue;

        const identity = {
            teamIndex: r.TeamIndex,
            name: r.DisplayName,
            mascot: r.NickName,
            abbr: r.Mascot_AssetName || '',
            colorPrimary: toHex(r.TEAM_BACKGROUNDCOLORR, r.TEAM_BACKGROUNDCOLORG, r.TEAM_BACKGROUNDCOLORB),
            colorSecondary: toHex(r.TEAM_BACKGROUNDCOLORR2, r.TEAM_BACKGROUNDCOLORG2, r.TEAM_BACKGROUNDCOLORB2),
            state: TEAM_STATE_BY_NAME[r.DisplayName] || null
        };

        let slots;
        try {
            slots = await resolveSeasonStatsSlots(franchise, r, statsCache);
        } catch (e) {
            slots = [null, null, null, null, null];
        }

        const currentLine = statsRowToStatLine(slots[0]) || {
            wins: 0, losses: 0, ties: 0, gamesPlayed: 0,
            offYards: 0, offPassYards: 0, offRushYards: 0, defPassYards: 0, defRushYards: 0,
            sacks: 0, defInts: 0, fumbleRec: 0, passTDs: 0, rushTDs: 0
        };
        currentTeams.push({
            ...identity,
            ...currentLine,
            confWins: r.ConfWin || 0, confLosses: r.ConfLoss || 0, confTies: r.ConfTie || 0,
            pointsFor: r.SeasonLeagPointsFor || 0, pointsAgainst: r.SeasonLeagPointsAgainst || 0,
            ratingOff: r.TEAM_RATINGOFF, ratingDef: r.TEAM_RATINGDEF, ratingOvr: r.TEAM_RATINGOVR,
            ratingQB: r.TEAM_RATINGQB, ratingRB: r.TEAM_RATINGRB, ratingWR: r.TEAM_RATINGWR,
            ratingTE: r.TEAM_RATINGTE, ratingOL: r.TEAM_RATINGOL,
            ratingDL: r.TEAM_RATINGDL, ratingLB: r.TEAM_RATINGLB, ratingDB: r.TEAM_RATINGDB, ratingST: r.TEAM_RATINGST,
            // The save's own in-game polls, straight from the Team record.
            // CFP is 0 (not yet ranked) until the game actually activates
            // committee rankings partway through a season - Media/Coaches
            // are populated from preseason on.
            mediaRank: r.MediaPoll_CurrentRank || 0,
            coachesRank: r.CoachesPoll_CurrentRank || 0,
            cfpRank: r.CFPPoll_CurrentRank || 0
        });

        for (let i = 1; i <= 4; i++) {
            const line = statsRowToStatLine(slots[i]);
            if (!line || line.gamesPlayed === 0) continue; // no completed season retained at this slot
            const year = currentYear - i;
            if (!historicalByYear.has(year)) historicalByYear.set(year, []);
            historicalByYear.get(year).push({
                ...identity, ...line,
                confWins: null, confLosses: null, confTies: null, // not retained per-season, only for the current year
                pointsFor: null, pointsAgainst: null,
                // Poll ranks are also a current-season-only live field on
                // Team - a completed season predating this feature has no
                // retained poll history either.
                mediaRank: null, coachesRank: null, cfpRank: null
            });
        }
    }

    const historicalSeasons = [...historicalByYear.entries()]
        .map(([year, teams]) => ({ year, teams }))
        .sort((a, b) => b.year - a.year);

    return { seasonYear: currentYear, seasonWeek: currentWeek, seasonStage: currentStage, currentTeams, historicalSeasons };
}

module.exports = { parseNationalTeamStats };
