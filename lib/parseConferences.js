const { utilService } = require('madden-franchise');

const NOT_A_REAL_TEAM_INDEX = 255; // shared placeholder index used by generic "FCS" filler teams

// The save's own "Independent" conference row exists but its TeamSlots
// reference doesn't resolve to a real Independent roster - it points at the
// same underlying array as Big 12, almost certainly a leftover/unused
// reference in the game's own data rather than anything meaningful. True
// independents (Notre Dame, UConn in this save) are derived below by
// exclusion instead - any real team not claimed by one of the OTHER
// conferences' TeamSlots gets bucketed here.
const INDEPENDENTS_LABEL = 'Independent';

function getMainTeamTable(franchise) {
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    return teamTables.find(t => t.header && t.header.recordCapacity >= 100);
}

/**
 * Resolves real conference membership from the save's own Conference table:
 * each conference record's TeamSlots field is a reference into a shared
 * Team[] array table (one row per conference, up to 20 team-reference slots
 * per row) holding that conference's actual current members. Returns a Map
 * of teamIndex -> conference name for every real team, with any team not
 * claimed by a named conference bucketed under "Independent".
 */
async function parseConferences(franchise) {
    const confTables = franchise.tables.filter(t => t.name === 'Conference');
    const confTable = confTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    if (!confTable) return { teamIndexToConference: new Map(), conferenceNames: [INDEPENDENTS_LABEL] };
    await confTable.readRecords();

    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    let slotsTable = null;
    const teamIndexToConference = new Map();
    const conferenceNames = [];

    for (const r of confTable.records) {
        if (r.isEmpty || !r.Name || r.Name === INDEPENDENTS_LABEL) continue; // skip the empty slot and the save's own unreliable "Independent" row
        try {
            const ref = utilService.getReferenceData(r.TeamSlots);
            if (!slotsTable) {
                slotsTable = franchise.getTableById(ref.tableId);
                await slotsTable.readRecords();
            }
            const slotsRec = slotsTable.records[ref.rowNumber];
            const slotFields = slotsTable.offsetTable.map(f => f.name);
            let anyMember = false;
            for (const f of slotFields) {
                try {
                    const teamRef = utilService.getReferenceData(slotsRec[f]);
                    if (franchise.getTableById(teamRef.tableId) !== teamTable) continue;
                    const teamRec = teamTable.records[teamRef.rowNumber];
                    if (!teamRec || teamRec.isEmpty || !teamRec.DisplayName) continue;
                    teamIndexToConference.set(teamRec.TeamIndex, r.Name);
                    anyMember = true;
                } catch (e) { /* empty slot */ }
            }
            if (anyMember) conferenceNames.push(r.Name);
        } catch (e) { /* conference has no resolvable TeamSlots - skip */ }
    }

    // Any real team not claimed above is a genuine independent.
    let hasIndependents = false;
    teamTable.records.forEach(r => {
        if (r.isEmpty || !r.DisplayName || r.TeamIndex === NOT_A_REAL_TEAM_INDEX) return;
        if (!teamIndexToConference.has(r.TeamIndex)) {
            teamIndexToConference.set(r.TeamIndex, INDEPENDENTS_LABEL);
            hasIndependents = true;
        }
    });
    if (hasIndependents) conferenceNames.push(INDEPENDENTS_LABEL);

    return { teamIndexToConference, conferenceNames: conferenceNames.sort() };
}

module.exports = { parseConferences, INDEPENDENTS_LABEL };
