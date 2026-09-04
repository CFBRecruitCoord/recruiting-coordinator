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

/**
 * Reads every real school's identity (name, mascot, colors, home state) from
 * the save. Real logos aren't recoverable from a save file - the game only
 * stores internal texture-library indices, not image files - so callers
 * should render a colored badge from these real colors instead.
 */
async function parseTeamsMeta(franchise) {
    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    const teams = [];
    teamTable.records.forEach(r => {
        if (r.isEmpty || !r.DisplayName) return;
        if (r.TeamIndex === NOT_A_REAL_TEAM_INDEX) return; // generic FCS filler team, not a real school

        teams.push({
            teamIndex: r.TeamIndex,
            name: r.DisplayName,
            mascot: r.NickName,
            abbr: r.Mascot_AssetName || '',
            colorPrimary: toHex(r.TEAM_BACKGROUNDCOLORR, r.TEAM_BACKGROUNDCOLORG, r.TEAM_BACKGROUNDCOLORB),
            colorSecondary: toHex(r.TEAM_BACKGROUNDCOLORR2, r.TEAM_BACKGROUNDCOLORG2, r.TEAM_BACKGROUNDCOLORB2),
            state: TEAM_STATE_BY_NAME[r.DisplayName] || null
        });
    });

    return teams;
}

function getBowlGameTable(franchise) {
    const bowlTables = franchise.tables.filter(t => t.name === 'BowlGame');
    return bowlTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
}

/**
 * Reads every real (non-playoff) bowl game slot from the save's fixed bowl
 * reference table, so a bowl the user hasn't been to yet can still be listed
 * with a 0-0 record instead of being omitted. CFP/playoff rounds share this
 * same table (flagged via IsPlayoffBowl) but are excluded here since they're
 * tracked separately under "Playoffs". A row's own index in this table is a
 * stable key across the life of the save (it's a small fixed-size built-in
 * reference table, not something that grows per-dynasty).
 */
async function parseBowlsMeta(franchise) {
    const table = getBowlGameTable(franchise);
    if (!table) return [];
    await table.readRecords();

    const bowls = [];
    table.records.forEach((r, i) => {
        if (r.isEmpty) return;
        if (r.IsPlayoffBowl) return;
        if (!r.Name) return; // blank/"Generic Bowl" placeholder slots
        bowls.push({ bowlIndex: i, name: r.Name });
    });
    return bowls;
}

/**
 * Scans the game's completed-games buffer for every game involving the
 * user's team, and returns each as a plain W-L result row. Note: this buffer
 * only holds a limited, rolling window of recently-played games (not a
 * permanent archive), so building a complete career game log requires
 * ingesting uploads regularly - each ingest captures whatever's currently
 * visible and merges it into our own persistent dynasty_games table.
 */
async function parseMyTeamGames(franchise, myTeamIndex) {
    const gameTables = franchise.tables.filter(t => t.name === 'SeasonGame');
    const archiveTable = gameTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    if (!archiveTable) return [];
    await archiveTable.readRecords();

    const mainTeamTable = getMainTeamTable(franchise);
    await mainTeamTable.readRecords();

    // BowlGame records carry an explicit IsPlayoffBowl flag, which is the only
    // reliable way to tell a genuine bowl game apart from a CFP playoff game -
    // both use the same "hosted at a bowl site" reference, so a name/site
    // check alone can't distinguish them (e.g. a first-round CFP game can be
    // hosted at an ordinary bowl site like the New Mexico Bowl).
    let bowlGameTable = null;

    const games = [];
    for (const r of archiveTable.records) {
        if (r.isEmpty) continue;
        if (r.GameStatus === 'Unplayed' || r.GameStatus === 'Invalid_') continue;

        let homeRef, awayRef;
        try {
            homeRef = utilService.getReferenceData(r.HomeTeam);
            awayRef = utilService.getReferenceData(r.AwayTeam);
        } catch (e) { continue; }

        const homeTable = franchise.getTableById(homeRef.tableId);
        const awayTable = franchise.getTableById(awayRef.tableId);
        if (homeTable !== mainTeamTable || awayTable !== mainTeamTable) continue;

        const homeTeamRec = mainTeamTable.records[homeRef.rowNumber];
        const awayTeamRec = mainTeamTable.records[awayRef.rowNumber];
        if (!homeTeamRec || !awayTeamRec) continue;

        let isHome;
        let opponentTeamIndex;
        if (homeTeamRec.TeamIndex === myTeamIndex) { isHome = true; opponentTeamIndex = awayTeamRec.TeamIndex; }
        else if (awayTeamRec.TeamIndex === myTeamIndex) { isHome = false; opponentTeamIndex = homeTeamRec.TeamIndex; }
        else continue; // not one of my games

        const myScore = isHome ? r.HomeScore : r.AwayScore;
        const oppScore = isHome ? r.AwayScore : r.HomeScore;
        const result = myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'T';

        const hasBowlRef = r.BowlGame && !/^0+$/.test(r.BowlGame);
        let isPlayoffBowl = false;
        let bowlIndex = null;
        if (hasBowlRef) {
            try {
                const bowlRef = utilService.getReferenceData(r.BowlGame);
                if (!bowlGameTable) {
                    bowlGameTable = franchise.getTableById(bowlRef.tableId);
                    await bowlGameTable.readRecords();
                }
                const bowlRec = bowlGameTable.records[bowlRef.rowNumber];
                isPlayoffBowl = !!(bowlRec && bowlRec.IsPlayoffBowl);
                bowlIndex = bowlRef.rowNumber;
            } catch (e) { /* leave as non-playoff if the reference can't be resolved */ }
        }
        const isPlayoff = isPlayoffBowl || r.SeasonWeekType === 'NationalChampionship';

        games.push({
            seasonYear: r.SeasonYear,
            seasonWeek: r.SeasonWeek,
            opponentTeamIndex,
            isHome,
            myScore,
            oppScore,
            result,
            isBowl: hasBowlRef && !isPlayoff, // genuine non-playoff bowl only
            isPlayoff,
            bowlIndex: (hasBowlRef && !isPlayoff) ? bowlIndex : null
        });
    }

    return games;
}

module.exports = { parseTeamsMeta, parseMyTeamGames, parseBowlsMeta };
