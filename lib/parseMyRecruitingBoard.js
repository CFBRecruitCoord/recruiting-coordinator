const { FranchiseFile, utilService } = require('madden-franchise');

/**
 * Parses the human-controlled team's actual in-game recruiting board -
 * UserRecruitTarget, a save-file table distinct from the national Recruit
 * pool (see lib/parseRecruits.js) that only exists for recruits the coach
 * has personally added to their board. Returns a lean overlay (keyed by
 * recruitIndex, the Recruit table's own row position) rather than
 * duplicating recruit identity/rating data - the caller joins this against
 * an already-parsed parseRecruits() array by recruitIndex.
 *
 * A save between recruiting cycles (e.g. right after Signing Day) can
 * legitimately have zero board entries - callers should treat an empty
 * array as "nothing on the board right now," not an error.
 */
async function parseMyRecruitingBoard(franchiseOrPath) {
    const franchise = typeof franchiseOrPath === 'string'
        ? await FranchiseFile.create(franchiseOrPath)
        : franchiseOrPath;

    const targetTable = franchise.tables.find(t => t.name === 'UserRecruitTarget' && !t.isArray);
    if (!targetTable) return [];
    await targetTable.readRecords();

    const board = [];
    for (const target of targetTable.records) {
        if (target.isEmpty) continue;

        const ref = utilService.getReferenceData(target.Recruit);
        // An unset reference resolves to table/row 0 rather than throwing -
        // that's this save's placeholder for "no recruit here," not a real link.
        if (!ref || (ref.tableId === 0 && ref.rowNumber === 0)) continue;

        const recruitTable = franchise.getTableById(ref.tableId);
        if (!recruitTable.records.length) await recruitTable.readRecords();
        const recruitRec = recruitTable.records[ref.rowNumber];
        if (!recruitRec || recruitRec.isEmpty) continue;

        board.push({
            recruitIndex: ref.rowNumber,
            isFavorite: !!target.IsFavorite,
            scholarshipStatus: target.ScholarshipStatus || null,
            hoursSpentThisWeek: target.ProspectHoursSpentCurrent || 0,
            nilExpectation: target.NILExpectation || 0,
            currentNilOffer: target.CurrentNILOffer || 0,
            committedWeek: target.CommittedWeekNumber > 0 ? target.CommittedWeekNumber : null
        });
    }
    return board;
}

module.exports = { parseMyRecruitingBoard };
