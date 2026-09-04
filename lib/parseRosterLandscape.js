const { FranchiseFile } = require('madden-franchise');

const NOT_A_REAL_TEAM_INDEX = 255; // shared placeholder index used by generic "FCS" filler teams
const STAR_NUM = { ONE_STAR: 1, TWO_STAR: 2, THREE_STAR: 3, FOUR_STAR: 4, FIVE_STAR: 5 };

function toHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0')).join('');
}

// How many starting spots each position slot realistically has on a single
// team, used to identify "starters" as the top-N players by Overall within
// that position on that roster. The save's own DepthChart references didn't
// resolve to sensible players (broken/garbled data), so this is a
// well-reasoned proxy rather than the game's literal depth chart.
const STARTER_SLOTS_BY_POSITION = {
    QB: 1, HB: 1, FB: 1, WR: 3, TE: 1,
    LT: 1, LG: 1, C: 1, RG: 1, RT: 1,
    LE: 1, RE: 1, DT: 1,
    LOLB: 1, MLB: 1, ROLB: 1,
    CB: 2, FS: 1, SS: 1,
    K: 1, P: 1
};

/**
 * Buckets the save's 0-10 TeamPrestige scale into a 4-tier system (1 =
 * lowest, 4 = highest). Boundaries are chosen from the real distribution of
 * TeamPrestige across all 138 teams in this save, which splits into four
 * roughly-even groups (~30-38 teams each) at these exact cutoffs.
 */
function prestigeTier(prestige) {
    if (prestige >= 7) return { tier: 4, label: 'Championship Caliber (7-10)' };
    if (prestige >= 5) return { tier: 3, label: 'Contending (5-6)' };
    if (prestige >= 3) return { tier: 2, label: 'Competing (3-4)' };
    return { tier: 1, label: 'Rebuilding (0-2)' };
}

function getMainTeamTable(franchise) {
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    return teamTables.find(t => t.header && t.header.recordCapacity >= 100);
}

/**
 * Parses every currently-rostered player (real team, real roster spot - not
 * a recruit still being pursued) across the whole league, tagging each with
 * their team's prestige tier, class (SchoolYear), and a "starter" flag.
 * Accepts either a save file path or an already-opened FranchiseFile (to
 * avoid re-reading a large save file twice when the caller also needs
 * parseRecruits from the same file).
 */
async function parseRosterLandscape(franchiseOrPath) {
    const franchise = typeof franchiseOrPath === 'string'
        ? await FranchiseFile.create(franchiseOrPath)
        : franchiseOrPath;

    const teamTable = getMainTeamTable(franchise);
    await teamTable.readRecords();

    const teamsByIndex = new Map();
    teamTable.records.forEach(r => {
        if (r.isEmpty || !r.DisplayName || r.TeamIndex === NOT_A_REAL_TEAM_INDEX) return;
        const { tier, label } = prestigeTier(r.TeamPrestige);
        teamsByIndex.set(r.TeamIndex, {
            name: r.DisplayName,
            mascot: r.NickName,
            abbr: r.Mascot_AssetName || '',
            colorPrimary: toHex(r.TEAM_BACKGROUNDCOLORR, r.TEAM_BACKGROUNDCOLORG, r.TEAM_BACKGROUNDCOLORB),
            colorSecondary: toHex(r.TEAM_BACKGROUNDCOLORR2, r.TEAM_BACKGROUNDCOLORG2, r.TEAM_BACKGROUNDCOLORB2),
            prestige: r.TeamPrestige, prestigeTier: tier, prestigeTierLabel: label
        });
    });

    const playerTables = franchise.tables.filter(t => t.name === 'Player');
    const playerTable = playerTables.reduce((biggest, t) =>
        (!biggest || t.header.recordCapacity > biggest.header.recordCapacity) ? t : biggest, null);
    await playerTable.readRecords();

    const rostered = [];
    playerTable.records.forEach(r => {
        if (r.isEmpty || !r.FirstName || !r.LastName) return;
        const team = teamsByIndex.get(r.TeamIndex);
        if (!team) return; // recruit, drafted-away, or otherwise not on a real current roster

        rostered.push({
            name: `${r.FirstName} ${r.LastName}`,
            position: r.Position,
            schoolYear: r.SchoolYear,
            // Permanently retained on the player record from their original
            // signing, regardless of how many years they've since been on a
            // roster - not just a "currently recruiting" field. Lets a
            // Freshman's entry double as that dynasty year's recruiting
            // class record (see lib/recruitingClassIngest.js) without
            // needing to separately track the volatile recruiting board.
            starsNum: STAR_NUM[r.ProspectStarRating] || null,
            homeState: r.PLYR_HOME_STATE || null,
            overall: r.OverallRating,
            speed: r.SpeedRating,
            strength: r.StrengthRating,
            awareness: r.AwarenessRating,
            agility: r.AgilityRating,
            acceleration: r.AccelerationRating,
            jumping: r.JumpingRating,
            throwPower: r.ThrowPowerRating,
            // There's no single meaningful "overall accuracy" field - the game
            // splits it into three (short/mid/deep), and a generic
            // ThrowAccuracyRating field also exists but holds unrelated low
            // values (verified: 15-37 regardless of QB quality) so it's not
            // used here. Averaging the three real ratings gives a sensible
            // single number instead.
            throwAccuracy: (r.ThrowAccuracyShortRating + r.ThrowAccuracyMidRating + r.ThrowAccuracyDeepRating) / 3,
            catching: r.CatchingRating,
            tackle: r.TackleRating,
            manCoverage: r.ManCoverageRating,
            runBlock: r.RunBlockRating,
            passBlock: r.PassBlockRating,
            teamIndex: r.TeamIndex,
            teamName: team.name,
            teamMascot: team.mascot,
            teamAbbr: team.abbr,
            teamColorPrimary: team.colorPrimary,
            teamColorSecondary: team.colorSecondary,
            teamPrestige: team.prestige,
            prestigeTier: team.prestigeTier,
            prestigeTierLabel: team.prestigeTierLabel,
            isStarter: false // filled in below
        });
    });

    const byTeamPosition = new Map();
    rostered.forEach(p => {
        const key = `${p.teamIndex}|${p.position}`;
        if (!byTeamPosition.has(key)) byTeamPosition.set(key, []);
        byTeamPosition.get(key).push(p);
    });
    byTeamPosition.forEach((group, key) => {
        const pos = key.split('|')[1];
        const starterSlots = STARTER_SLOTS_BY_POSITION[pos] || 1;
        group.sort((a, b) => b.overall - a.overall);
        group.forEach((p, i) => { p.isStarter = i < starterSlots; });
    });

    return rostered;
}

module.exports = { parseRosterLandscape, prestigeTier, STARTER_SLOTS_BY_POSITION };
