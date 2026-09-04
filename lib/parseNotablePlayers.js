const { utilService } = require('madden-franchise');

// Same starter-slot logic as parseRosterLandscape.js, duplicated (not
// shared) since this needs it scoped to one team only rather than every
// team nationally - re-deriving starters for ~85 players is cheap, and
// pulling in the national roster parser here would mean re-filtering its
// output back down to one team for no benefit.
const STARTER_SLOTS_BY_POSITION = {
    QB: 1, HB: 1, FB: 1, WR: 3, TE: 1,
    LT: 1, LG: 1, C: 1, RG: 1, RT: 1,
    LE: 1, RE: 1, DT: 1,
    LOLB: 1, MLB: 1, ROLB: 1,
    CB: 2, FS: 1, SS: 1,
    K: 1, P: 1
};

// Which of a player's real, permanently-tracked CAREER stats (see
// Player.CareerStats in the save - resolves to CareerOffensiveStats /
// CareerOffensiveKPReturnStats / CareerDefensiveStats depending on
// position, but the field names line up across all three) are worth
// showing for that position. Intentionally scoped to skill positions +
// defenders per the current ask - OL/K/P have no comparable individual
// counting stat, so they're left with just Overall/bio.
const KEY_STAT_FIELDS_BY_POSITION = {
    QB: [['passYards', 'PASSYARDS'], ['passTDs', 'PASSTDS'], ['passInts', 'PASSINTS']],
    HB: [['rushYards', 'RUSHYARDS'], ['rushTDs', 'RUSHTDS']],
    FB: [['rushYards', 'RUSHYARDS'], ['rushTDs', 'RUSHTDS']],
    WR: [['receiveYards', 'RECEIVEYARDS'], ['receiveTDs', 'RECEIVETDS'], ['receiveCatches', 'RECEIVECATCHES']],
    TE: [['receiveYards', 'RECEIVEYARDS'], ['receiveTDs', 'RECEIVETDS'], ['receiveCatches', 'RECEIVECATCHES']],
    LE: [['tackles', 'DEFTACKLES'], ['sacks', 'DLINESACKS'], ['tacklesForLoss', 'DEFTACKLESFORLOSS']],
    RE: [['tackles', 'DEFTACKLES'], ['sacks', 'DLINESACKS'], ['tacklesForLoss', 'DEFTACKLESFORLOSS']],
    DT: [['tackles', 'DEFTACKLES'], ['sacks', 'DLINESACKS'], ['tacklesForLoss', 'DEFTACKLESFORLOSS']],
    LOLB: [['tackles', 'DEFTACKLES'], ['sacks', 'DLINESACKS'], ['ints', 'DSECINTS']],
    MLB: [['tackles', 'DEFTACKLES'], ['sacks', 'DLINESACKS'], ['ints', 'DSECINTS']],
    ROLB: [['tackles', 'DEFTACKLES'], ['sacks', 'DLINESACKS'], ['ints', 'DSECINTS']],
    CB: [['tackles', 'DEFTACKLES'], ['ints', 'DSECINTS'], ['passDeflections', 'DEFPASSDEFLECTIONS']],
    FS: [['tackles', 'DEFTACKLES'], ['ints', 'DSECINTS'], ['passDeflections', 'DEFPASSDEFLECTIONS']],
    SS: [['tackles', 'DEFTACKLES'], ['ints', 'DSECINTS'], ['passDeflections', 'DEFPASSDEFLECTIONS']]
};

/**
 * Reads the user's own team's current starters (same "top N by Overall at
 * this position" rule National Power Rankings uses) along with each one's
 * real career stats, straight from the save's own CareerStats record - no
 * need to reconstruct anything from game logs. Scoped to just this one team
 * (not the full national Player table) since only the user's own program's
 * players are ever relevant here.
 */
async function parseNotablePlayers(franchise, teamIndex) {
    const playerTables = franchise.tables.filter(t => t.name === 'Player');
    const playerTable = playerTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    await playerTable.readRecords();

    const teamPlayers = playerTable.records.filter(r => !r.isEmpty && r.FirstName && r.TeamIndex === teamIndex);

    const byPosition = new Map();
    teamPlayers.forEach(p => {
        if (!byPosition.has(p.Position)) byPosition.set(p.Position, []);
        byPosition.get(p.Position).push(p);
    });

    const starters = [];
    byPosition.forEach((players, pos) => {
        const slots = STARTER_SLOTS_BY_POSITION[pos];
        if (!slots) return;
        players.slice().sort((a, b) => b.OverallRating - a.OverallRating).slice(0, slots).forEach(p => starters.push(p));
    });

    const statTableCache = new Map(); // tableId -> table, shared across starters (most share the same 2-3 underlying tables)
    const results = [];
    for (const p of starters) {
        const keyStatFields = KEY_STAT_FIELDS_BY_POSITION[p.Position];
        const stats = {};
        if (keyStatFields) {
            try {
                const ref = utilService.getReferenceData(p.CareerStats);
                let statTable = statTableCache.get(ref.tableId);
                if (!statTable) {
                    statTable = franchise.getTableById(ref.tableId);
                    await statTable.readRecords();
                    statTableCache.set(ref.tableId, statTable);
                }
                const rec = statTable.records[ref.rowNumber];
                keyStatFields.forEach(([outKey, fieldName]) => {
                    try { stats[outKey] = rec[fieldName] || 0; } catch (e) { /* field doesn't exist on this stat table variant */ }
                });
            } catch (e) { /* true freshman with no career stats resolved yet */ }
        }

        results.push({
            // PLYR_ASSETNAME (a real, permanent per-player id elsewhere in
            // the save) is only populated for a small subset of licensed
            // players - empty for the generated majority of a college
            // roster (verified: 0/76 populated on a real team) - and
            // PresentationId, while always set, isn't reliably unique
            // (duplicates found across the national player pool). Neither
            // is safe alone, so the dedup key is a composite of bio fields
            // that are set once at generation and never change afterward -
            // collision would need two players with the exact same name,
            // position, height, weight, AND hometown.
            playerKey: [p.FirstName, p.LastName, p.Position, p.Height, p.Weight, p.PLYR_HOME_TOWN, p.PLYR_HOME_STATE]
                .map(v => String(v == null ? '' : v).trim()).join('|'),
            name: `${p.FirstName} ${p.LastName}`,
            position: p.Position,
            overall: p.OverallRating,
            schoolYear: p.SchoolYear,
            stats
        });
    }

    return results;
}

module.exports = { parseNotablePlayers };
