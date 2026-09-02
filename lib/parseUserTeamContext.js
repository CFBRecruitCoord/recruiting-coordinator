const { FranchiseFile, utilService } = require('madden-franchise');
const { TEAM_STATE_BY_NAME } = require('./teamStates');

// Pipeline region names are finer-grained than a full US state (e.g. Baylor's
// save has "EastTexas", "NorthTexas", "SouthwestTexas" instead of one
// "Texas" entry). There's no data linking a recruit's exact hometown to
// which sub-region of a state they're in, so pipelines are rolled up to the
// state level by stripping the directional prefix - a reasonable
// approximation, not an exact match. Compound directions (Southwest,
// Northeast, ...) must be checked before their plain counterparts (South,
// North, ...), or "SouthwestTexas" strips to "westTexas" instead of "Texas".
const DIRECTION_PREFIX = /^(Northeast|Northwest|Southeast|Southwest|North|South|East|West|Central)/;
function pipelineRegionToState(regionName) {
    return regionName.replace(DIRECTION_PREFIX, '');
}

function getMainTeamTable(franchise) {
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    return teamTables.find(t => t.header && t.header.recordCapacity >= 100);
}

/**
 * Finds the human-controlled team and everything the Recruit Targets tab
 * needs to know about it: identity, recruiting-pitch grades, program-point
 * budget, and state-level recruiting pipeline strength. Returns null if no
 * user-controlled team is found (e.g. an AI-only save).
 */
async function parseUserTeamContext(franchiseOrPath) {
    const franchise = typeof franchiseOrPath === 'string'
        ? await FranchiseFile.create(franchiseOrPath)
        : franchiseOrPath;

    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    const myTeam = teamTable.records.find(r =>
        !r.isEmpty && r.UserCharacter && !/^0+$/.test(r.UserCharacter) && r.HeadCoach
    );
    if (!myTeam) return null;

    // Pipeline slots are references to SchoolPipelineInfluence records (not
    // raw numbers) - resolve each populated one, then roll region-level
    // influence up to state level (a team can have multiple pipeline
    // entries feeding into the same state, e.g. three separate Texas regions).
    const pipelineByState = {};
    try {
        const listRef = utilService.getReferenceData(myTeam.SchoolPipelineInfluenceList);
        const listTable = franchise.getTableById(listRef.tableId);
        await listTable.readRecords();
        const listRec = listTable.records[listRef.rowNumber];

        let influenceTable = null;
        for (let i = 0; i < 42; i++) {
            const val = listRec[`SchoolPipelineInfluence${i}`];
            if (!val || /^0+$/.test(val)) continue;
            const ref = utilService.getReferenceData(val);
            if (!influenceTable) {
                influenceTable = franchise.getTableById(ref.tableId);
                await influenceTable.readRecords();
            }
            const infRec = influenceTable.records[ref.rowNumber];
            if (!infRec || infRec.isEmpty || !infRec.Pipeline) continue;
            const state = pipelineRegionToState(infRec.Pipeline);
            const value = infRec.InfluenceValue || 0;
            // Multiple regions can roll into the same state - keep the strongest.
            pipelineByState[state] = Math.max(pipelineByState[state] || 0, value);
        }
    } catch (e) {
        // Leave pipelineByState empty if pipeline data can't be resolved -
        // Recruit Targets treats that as "no known pipeline bonus" rather than failing.
    }

    return {
        teamIndex: myTeam.TeamIndex,
        name: myTeam.DisplayName,
        state: TEAM_STATE_BY_NAME[myTeam.DisplayName] ? TEAM_STATE_BY_NAME[myTeam.DisplayName].replace(/\s/g, '') : null,
        prestige: myTeam.TeamPrestige,
        facilitiesLevel: myTeam.FacilitiesLevel,
        grades: {
            brandExposure: myTeam.ProgramPointsBrandExposureGrade,
            budget: myTeam.ProgramPointsBudgetGrade,
            conferencePrestige: myTeam.ProgramPointsConferencePrestigeGrade,
            programTraditions: myTeam.ProgramPointsProgramTraditionsGrade,
            stadiumAtmosphere: myTeam.ProgramPointsStadiumAtmosphereGrade
        },
        budget: {
            total: myTeam.ProgramPointBudget,
            remaining: myTeam.RemainingProgramPoints,
            rollover: myTeam.RolloverProgramPoints,
            nilSpent: myTeam.NILProgramPointsSpent
        },
        pipelineByState
    };
}

module.exports = { parseUserTeamContext, pipelineRegionToState };
