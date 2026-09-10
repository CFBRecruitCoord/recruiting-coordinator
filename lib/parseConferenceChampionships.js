const { utilService } = require('madden-franchise');

function getMainTeamTable(franchise) {
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    return teamTables.find(t => t.header && t.header.recordCapacity >= 100);
}

/**
 * Reads every conference's championship game result the save currently
 * retains, as many completed seasons back as it keeps - LeagueHistoryConference
 * Champion has no explicit year field, but (like LeagueHistoryAward) lays out
 * one fixed block of entries per completed season back to back, so the block
 * size (self-derived from the distinct conference names actually present,
 * rather than hard-coded, in case a save has more/fewer conferences) is what
 * recovers each row's real year.
 */
async function parseConferenceChampionships(franchise) {
    const seasonInfoTable = franchise.tables.filter(t => t.name === 'SeasonInfo')[0];
    await seasonInfoTable.readRecords();
    const seasonInfo = seasonInfoTable.records.find(r => !r.isEmpty);
    const currentYear = seasonInfo.CurrentYear;

    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    const lhccTables = franchise.tables.filter(t => t.name === 'LeagueHistoryConferenceChampion' && !t.isArray);
    const lhcc = lhccTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    if (!lhcc) return { seasonYear: currentYear, results: [] };
    await lhcc.readRecords();

    const nonEmpty = [];
    lhcc.records.forEach(r => { if (!r.isEmpty && r.ConferenceName) nonEmpty.push(r); });
    const conferenceCount = new Set(nonEmpty.map(r => r.ConferenceName)).size;
    if (!conferenceCount) return { seasonYear: currentYear, results: [] };

    function resolveTeamIndex(refField) {
        try {
            const ref = utilService.getReferenceData(refField);
            const team = teamTable.records[ref.rowNumber];
            return team ? team.TeamIndex : null;
        } catch (e) { return null; }
    }

    const results = [];
    nonEmpty.forEach((r, idx) => {
        const yearSlot = Math.floor(idx / conferenceCount);
        const year = currentYear - 1 - yearSlot;
        if (year < 0) return;

        results.push({
            year,
            conference: r.ConferenceName,
            winnerTeamIndex: resolveTeamIndex(r.WinningTeamIdentity),
            winnerScore: r.WinningTeamScore || 0,
            loserTeamIndex: resolveTeamIndex(r.LosingTeamIdentity),
            loserScore: r.LosingTeamScore || 0
        });
    });

    return { seasonYear: currentYear, results };
}

module.exports = { parseConferenceChampionships };
