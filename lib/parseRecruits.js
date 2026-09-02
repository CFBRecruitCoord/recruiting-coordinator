const { FranchiseFile, utilService } = require('madden-franchise');

const STAR_NUM = { ONE_STAR: 1, TWO_STAR: 2, THREE_STAR: 3, FOUR_STAR: 4, FIVE_STAR: 5 };
const STAR_LABEL = { ONE_STAR: '1', TWO_STAR: '2', THREE_STAR: '3', FOUR_STAR: '4', FIVE_STAR: '5' };
const MIN_BUCKET_SIZE = 3;
const SPEED_WEIGHT = 0.15;
const STRENGTH_WEIGHT = 0.15;
const GEM_BONUS = 0.5;
const NIL_WEIGHT = 0.03;

function heightStr(inches) {
    if (!inches) return 'N/A';
    const ft = Math.floor(inches / 12);
    const inch = inches % 12;
    return `${ft}'${inch}"`;
}

const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

/**
 * Parses a CFB 27 dynasty save file and returns every valid recruit enriched
 * with Raw Rating and NIL Adjusted Rating scores.
 * @param {string|object} franchiseOrPath - a save file path, or an already-opened
 *   FranchiseFile (so callers that also need parseRosterLandscape from the same
 *   file don't have to open and read a large save file twice).
 * @returns {Promise<Array<Object>>}
 */
async function parseRecruits(franchiseOrPath) {
    const franchise = typeof franchiseOrPath === 'string'
        ? await FranchiseFile.create(franchiseOrPath)
        : franchiseOrPath;

    const recruitTable = franchise.tables.find(t => t.name === 'Recruit' && !t.isArray);
    await recruitTable.readRecords();
    const nonEmpty = recruitTable.records.filter(
        r => !r.isEmpty && r.RecruitStage !== 'Invalid' && r.NationalRank > 0
    );

    let playerTable = null;
    const all = [];

    for (const rec of nonEmpty) {
        const refData = utilService.getReferenceData(rec.Player);
        if (!playerTable) {
            playerTable = franchise.getTableById(refData.tableId);
            await playerTable.readRecords();
        }
        const p = playerTable.records[refData.rowNumber];
        if (!p.FirstName && !p.LastName) continue;
        if (!STAR_NUM[p.ProspectStarRating]) continue;

        all.push({
            rank: rec.NationalRank,
            posRank: rec.PositionRank,
            stateRank: rec.StateRank,
            stage: rec.RecruitStage,
            gem: rec.QualityModifier,
            topSchoolsRef: rec.TopSchoolsList, // raw reference string; resolved to names in a later pass
            name: `${p.FirstName} ${p.LastName}`,
            position: p.Position,
            starsRaw: p.ProspectStarRating,
            stars: STAR_LABEL[p.ProspectStarRating],
            starsNum: STAR_NUM[p.ProspectStarRating],
            overall: p.OverallRating,
            height: heightStr(p.Height),
            weight: p.Weight + 160,
            hometown: p.PLYR_HOME_TOWN,
            homeState: p.PLYR_HOME_STATE,
            speed: p.SpeedRating,
            strength: p.StrengthRating,
            awareness: p.AwarenessRating,
            agility: p.AgilityRating,
            acceleration: p.AccelerationRating,
            jumping: p.JumpingRating,
            nil: p.BaseNILValue
        });
    }

    // Baselines from the full valid recruit pool (all positions/stars included)
    const speedByPos = {}, strengthByPos = {}, overallByStar = {}, overallByPosStar = {};
    const nilByStar = {}, nilByPosStar = {};
    all.forEach(r => {
        (speedByPos[r.position] = speedByPos[r.position] || []).push(r.speed);
        (strengthByPos[r.position] = strengthByPos[r.position] || []).push(r.strength);
        (overallByStar[r.starsNum] = overallByStar[r.starsNum] || []).push(r.overall);
        (nilByStar[r.starsNum] = nilByStar[r.starsNum] || []).push(r.nil);
        const key = `${r.position}|${r.starsNum}`;
        (overallByPosStar[key] = overallByPosStar[key] || []).push(r.overall);
        (nilByPosStar[key] = nilByPosStar[key] || []).push(r.nil);
    });

    const avgSpeedByPos = {}, avgStrengthByPos = {}, avgOverallByStar = {}, avgOverallByPosStar = {};
    const avgNilByStar = {}, avgNilByPosStar = {};
    Object.keys(speedByPos).forEach(k => avgSpeedByPos[k] = avg(speedByPos[k]));
    Object.keys(strengthByPos).forEach(k => avgStrengthByPos[k] = avg(strengthByPos[k]));
    Object.keys(overallByStar).forEach(k => avgOverallByStar[k] = avg(overallByStar[k]));
    Object.keys(overallByPosStar).forEach(k => avgOverallByPosStar[k] = avg(overallByPosStar[k]));
    Object.keys(nilByStar).forEach(k => avgNilByStar[k] = avg(nilByStar[k]));
    Object.keys(nilByPosStar).forEach(k => avgNilByPosStar[k] = avg(nilByPosStar[k]));

    all.forEach(r => {
        const posStarKey = `${r.position}|${r.starsNum}`;
        const bucketSize = overallByPosStar[posStarKey].length;
        const useThinFallback = bucketSize < MIN_BUCKET_SIZE;

        const overallBaseline = useThinFallback ? avgOverallByStar[r.starsNum] : avgOverallByPosStar[posStarKey];
        const nilBaseline = useThinFallback ? avgNilByStar[r.starsNum] : avgNilByPosStar[posStarKey];

        r.baseGap = +(r.overall - overallBaseline).toFixed(2);
        r.speedMult = +((r.speed - avgSpeedByPos[r.position]) * SPEED_WEIGHT).toFixed(2);
        r.strengthMult = +((r.strength - avgStrengthByPos[r.position]) * STRENGTH_WEIGHT).toFixed(2);
        r.gemBonus = r.gem === 'GEM' ? GEM_BONUS : 0;
        r.nilDelta = +(r.nil - nilBaseline).toFixed(1);
        r.nilAdjustment = +(-r.nilDelta * NIL_WEIGHT).toFixed(2);

        r.rawRating = +(r.baseGap + r.speedMult + r.strengthMult + r.gemBonus).toFixed(2);
        r.nilAdjustedRating = +(r.rawRating + r.nilAdjustment).toFixed(2);
    });

    await attachInterestedSchools(franchise, all);
    all.forEach(r => { delete r.topSchoolsRef; }); // internal-only, not needed downstream

    return all;
}

/**
 * Resolves each recruit's TopSchoolsList reference into a plain array of school
 * display names (e.g. "Alabama", "Texas"). Mutates each recruit object in-place,
 * adding an `interestedSchools` array. Done as a separate pass, after all Recruit/
 * Player field reads are complete, to avoid a library quirk where re-reading an
 * enum/reference field on a record after other tables have been read can return
 * stale/incorrect values.
 */
async function attachInterestedSchools(franchise, all) {
    const withRef = all.filter(r => r.topSchoolsRef);
    if (!withRef.length) {
        all.forEach(r => { r.interestedSchools = []; r.userTeamInterest = null; });
        return;
    }

    // Build TeamIndex -> display name map from the main 130+ team roster
    // table, and identify the human-controlled team the same way the rest
    // of the app does (real UserCharacter reference + a HeadCoach set).
    const teamTables = franchise.tables.filter(t => t.name === 'Team');
    let teamById = {};
    let userTeamIndex = null;
    for (const t of teamTables) {
        if (t.header && t.header.recordCapacity >= 100) {
            await t.readRecords();
            t.records.forEach(r => {
                if (!r.isEmpty && r.DisplayName) teamById[r.TeamIndex] = r.DisplayName;
                if (!r.isEmpty && r.UserCharacter && !/^0+$/.test(r.UserCharacter) && r.HeadCoach) {
                    userTeamIndex = r.TeamIndex;
                }
            });
            break;
        }
    }

    // Prime the array table (ProspectTargetSchool[]) and the underlying
    // ProspectTargetSchool table using the first recruit's reference.
    const primerRef = utilService.getReferenceData(withRef[0].topSchoolsRef);
    const arrTable = franchise.getTableById(primerRef.tableId);
    await arrTable.readRecords();
    const primerArrRecord = arrTable.records[primerRef.rowNumber];
    const slotRef0 = utilService.getReferenceData(primerArrRecord.ProspectTargetSchool0);
    const schoolTable = franchise.getTableById(slotRef0.tableId);
    await schoolTable.readRecords();

    all.forEach(r => {
        if (!r.topSchoolsRef) { r.interestedSchools = []; r.userTeamInterest = null; return; }
        const refData = utilService.getReferenceData(r.topSchoolsRef);
        const arrRecord = arrTable.records[refData.rowNumber];
        if (!arrRecord) { r.interestedSchools = []; r.userTeamInterest = null; return; }

        const schools = [];
        let userTeamInterest = null;
        for (let i = 0; i < 10; i++) {
            const slotRef = arrRecord[`ProspectTargetSchool${i}`];
            if (!slotRef) continue;
            const slotRefData = utilService.getReferenceData(slotRef);
            const schoolRecord = schoolTable.records[slotRefData.rowNumber];
            if (!schoolRecord || schoolRecord.isEmpty) continue;
            if (!schoolRecord.TeamInfluence || schoolRecord.TeamInfluence <= 0) continue; // padding/unused slot
            const teamName = teamById[schoolRecord.TeamId];
            if (teamName && !schools.includes(teamName)) schools.push(teamName);
            // Interest strength (0-100ish) in the user's own team specifically,
            // not just whether they're on the list - null if the user's team
            // isn't among this recruit's considered schools at all.
            if (userTeamIndex !== null && schoolRecord.TeamId === userTeamIndex) {
                userTeamInterest = schoolRecord.TeamInfluence;
            }
        }
        r.interestedSchools = schools;
        r.userTeamInterest = userTeamInterest;
    });
}

module.exports = { parseRecruits };
