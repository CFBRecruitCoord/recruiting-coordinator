const { utilService } = require('madden-franchise');

// The save doesn't expose a display-name table for these award-type enums,
// so these are cleaned-up labels derived from the raw codes (verified
// against real winners in a save - e.g. BEST_QB winners are legitimate
// standout quarterbacks, HEISMAN winners are the marquee overall honor).
// Order doesn't matter for lookups, but its LENGTH does: LeagueHistoryAward
// (see parseAwards below) lays out exactly this many rows per completed
// season, back to back, with no year field of its own - the row's position
// is the only way to recover which year it belongs to.
const AWARD_LABELS = {
    HEISMAN: 'Heisman Trophy',
    BEST_POTY: 'Player of the Year',
    BEST_FRESHMAN_POTY: 'Freshman of the Year',
    MOST_VERSATILE: 'Most Versatile Player',
    BEST_ACADEMIC: 'Academic Player of the Year',
    BEST_PLAYER: 'Best Player',
    BEST_SR_QB: 'Best Senior Quarterback',
    BEST_DEF_1: 'Defensive Player of the Year',
    BEST_DEF_2: 'Defensive MVP',
    BEST_DE: 'Best Defensive End',
    BEST_REC: 'Best Receiver',
    BEST_QB: 'Best Quarterback',
    BEST_RB: 'Best Running Back',
    BEST_TE: 'Best Tight End',
    BEST_KICK: 'Best Kicker',
    BEST_IL: 'Best Interior Lineman',
    BEST_DB: 'Best Defensive Back',
    BEST_PUNT: 'Best Punter',
    BEST_C: 'Best Center',
    BEST_SR: 'Best Senior',
    BEST_LB: 'Best Linebacker',
    BEST_DL: 'Best Defensive Lineman',
    BEST_HC: 'Best Head Coach',
    BEST_AC: 'Best Assistant Coach'
};
const AWARD_TYPE_COUNT = Object.keys(AWARD_LABELS).length;

function getMainTeamTable(franchise) {
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    return teamTables.find(t => t.header && t.header.recordCapacity >= 100);
}

/**
 * Reads the save's awards data: the live current-week Heisman race (the
 * only award with a real in-season leaderboard - HeismanAwardRanking - every
 * other award is only ever decided at season's end) and the full historical
 * winners list for all 24 tracked awards, as many completed seasons back as
 * the save retains (LeagueHistoryAward - confirmed to keep growing with
 * every completed season rather than a fixed rolling window, unlike
 * TeamStats' 5-slot history).
 */
async function parseAwards(franchise) {
    const seasonInfoTable = franchise.tables.filter(t => t.name === 'SeasonInfo')[0];
    await seasonInfoTable.readRecords();
    const seasonInfo = seasonInfoTable.records.find(r => !r.isEmpty);
    const currentYear = seasonInfo.CurrentYear;

    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    // ---- Current Heisman race ----
    const harTables = franchise.tables.filter(t => t.name === 'HeismanAwardRanking' && !t.isArray);
    const har = harTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    await har.readRecords();

    const playerTables = franchise.tables.filter(t => t.name === 'Player');
    const playerTable = playerTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    await playerTable.readRecords();

    const heismanRace = [];
    har.records.forEach(r => {
        if (r.isEmpty) return;
        try {
            const teamRef = utilService.getReferenceData(r.Team);
            const team = teamTable.records[teamRef.rowNumber];
            const playerRef = utilService.getReferenceData(r.Player);
            const player = playerTable.records[playerRef.rowNumber];
            if (!team || !player || !player.FirstName) return;
            heismanRace.push({
                rank: r.CurrentRank || 0,
                lastWeekRank: r.LastWeekRank,
                name: `${player.FirstName} ${player.LastName}`,
                position: player.Position,
                teamIndex: team.TeamIndex
            });
        } catch (e) { /* unresolved slot */ }
    });
    heismanRace.sort((a, b) => a.rank - b.rank);

    // ---- Historical winners: all completed seasons the save retains ----
    const lhaTables = franchise.tables.filter(t => t.name === 'LeagueHistoryAward' && !t.isArray);
    const lha = lhaTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    await lha.readRecords();

    const historicalWinners = [];
    lha.records.forEach((r, idx) => {
        if (r.isEmpty || !r.AwardType) return;
        const yearSlot = Math.floor(idx / AWARD_TYPE_COUNT);
        const awardYear = currentYear - 1 - yearSlot;
        if (awardYear < 0) return;

        let teamIndex = null;
        try {
            const ref = utilService.getReferenceData(r.TeamIdentity);
            const team = teamTable.records[ref.rowNumber];
            if (team) teamIndex = team.TeamIndex;
        } catch (e) { /* unresolved */ }

        const name = `${r.firstName || ''} ${r.lastName || ''}`.trim();
        if (!name) return;

        historicalWinners.push({
            awardType: r.AwardType,
            awardYear,
            name,
            position: r.Position,
            teamIndex
        });
    });

    return {
        seasonYear: currentYear, seasonWeek: seasonInfo.CurrentWeek, seasonStage: seasonInfo.CurrentStage,
        heismanRace, historicalWinners
    };
}

module.exports = { parseAwards, AWARD_LABELS };
