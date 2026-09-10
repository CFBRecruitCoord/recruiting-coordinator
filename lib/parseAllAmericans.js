const { utilService } = require('madden-franchise');
const { parseConferences } = require('./parseConferences');

// Only the real, final teams - deliberately excludes the _PRE (preseason
// projection) variant. ALL_AM_FR (national Freshman All-American) is
// captured for the Coaching Career summary banner's count, even though the
// All-Americans tab itself only ever queries team='1st'/'2nd' - adding it
// here doesn't change that tab's behavior, just makes the freshman count
// available to whatever queries for it. ALL_AM_FR_CONF (all-conference
// freshman honors) stays out of scope - not asked for anywhere yet.
const TYPE_META = {
    ALL_AM_1ST: { scope: 'national', team: '1st' },
    ALL_AM_2ND: { scope: 'national', team: '2nd' },
    ALL_AM_FR: { scope: 'national', team: 'fr' },
    ALL_AM_1ST_CONF: { scope: 'conference', team: '1st' },
    ALL_AM_2ND_CONF: { scope: 'conference', team: '2nd' }
};

function getMainTeamTable(franchise) {
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    return teamTables.find(t => t.header && t.header.recordCapacity >= 100);
}

/**
 * Reads every real (non-preseason) 1st/2nd Team All-American selection the
 * save currently retains - both the true national team and the fuller
 * per-conference All-Conference teams. PlayerAward (unlike LeagueHistoryAward
 * for the other awards) is a shared rolling buffer across many award types
 * including weekly honors, so PeriodIndex is read directly as the real
 * dynasty year here (confirmed: preseason variants for the CURRENT
 * in-progress year are already populated, exactly like the Heisman
 * preseason watch list) rather than needing year-slot math.
 */
async function parseAllAmericans(franchise) {
    const seasonInfoTable = franchise.tables.filter(t => t.name === 'SeasonInfo')[0];
    await seasonInfoTable.readRecords();
    const seasonInfo = seasonInfoTable.records.find(r => !r.isEmpty);

    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    const playerTables = franchise.tables.filter(t => t.name === 'Player');
    const playerTable = playerTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    await playerTable.readRecords();

    const { teamIndexToConference } = await parseConferences(franchise);

    const paTables = franchise.tables.filter(t => t.name === 'PlayerAward' && !t.isArray);
    const pa = paTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    await pa.readRecords();

    const selections = [];
    pa.records.forEach(r => {
        if (r.isEmpty || !r.AwardType) return;
        const meta = TYPE_META[r.AwardType];
        if (!meta) return;

        try {
            const playerRef = utilService.getReferenceData(r.Player);
            const player = playerTable.records[playerRef.rowNumber];
            if (!player || !player.FirstName) return;

            const teamRef = utilService.getReferenceData(r.Team);
            const team = teamTable.records[teamRef.rowNumber];
            if (!team) return;

            selections.push({
                scope: meta.scope, team: meta.team,
                year: r.PeriodIndex,
                name: `${player.FirstName} ${player.LastName}`,
                position: r.Position,
                teamIndex: team.TeamIndex,
                conference: teamIndexToConference.get(team.TeamIndex) || null
            });
        } catch (e) { /* unresolved reference */ }
    });

    return { seasonYear: seasonInfo.CurrentYear, selections };
}

module.exports = { parseAllAmericans };
