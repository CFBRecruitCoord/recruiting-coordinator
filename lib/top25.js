/**
 * Turns a value into its percentile position (0 = worst, 1 = best) within a
 * list of teams for one metric - the common scale everything below is
 * blended on, so "3345 passing yards" and "39 passing TDs" can be averaged
 * together meaningfully. Ties share the same percentile (average-rank
 * method) so a stat everyone's tied on (e.g. all-zero preseason fumbles)
 * doesn't arbitrarily favor whoever happens to be earlier in the array.
 */
function buildPercentileLookup(teams, getValue) {
    const values = teams.map(getValue);
    const sorted = [...values].sort((a, b) => a - b);
    return value => {
        let lo = 0, hi = 0;
        for (const v of sorted) {
            if (v < value) lo++;
            if (v <= value) hi++;
        }
        if (sorted.length <= 1) return 0.5;
        return ((lo + hi - 1) / 2) / (sorted.length - 1);
    };
}

/**
 * Blends several percentile-scored metrics into one 0-1 score. Each entry is
 * {get, invert}; invert=true means lower-is-better (e.g. yards allowed), so
 * its percentile gets flipped before averaging. Weights are implicitly equal
 * (a plain average) among whichever metrics are actually available for this
 * team set - e.g. historical completed seasons have no points data, so that
 * metric is simply dropped rather than forcing every team to 0 for it.
 */
function blendScore(teams, metrics) {
    const lookups = metrics.map(m => ({ ...m, lookup: buildPercentileLookup(teams, m.get) }));
    return team => {
        const scores = lookups.map(m => {
            const pct = m.lookup(m.get(team));
            return m.invert ? 1 - pct : pct;
        });
        return scores.reduce((a, b) => a + b, 0) / scores.length;
    };
}

const OFFENSE_METRICS_PLAYED = [
    { get: t => t.offYards, invert: false },
    { get: t => t.offPassYards, invert: false },
    { get: t => t.offRushYards, invert: false },
    { get: t => t.pointsFor, invert: false }
];
const OFFENSE_METRICS_PLAYED_NO_POINTS = OFFENSE_METRICS_PLAYED.filter(m => m !== OFFENSE_METRICS_PLAYED[3]);

const DEFENSE_METRICS_PLAYED = [
    { get: t => t.defPassYards + t.defRushYards, invert: true },
    { get: t => t.defPassYards, invert: true },
    { get: t => t.defRushYards, invert: true },
    { get: t => t.pointsAgainst, invert: true },
    { get: t => t.sacks, invert: false },
    { get: t => t.defInts, invert: false },
    { get: t => t.fumbleRec, invert: false }
];
const DEFENSE_METRICS_PLAYED_NO_POINTS = DEFENSE_METRICS_PLAYED.filter((m, i) => i !== 3);

// Fallback for teams with zero games played (preseason): the save's own
// composite position-group ratings stand in for produced-stats, weighted
// toward the overall unit rating with the individual position groups as a
// secondary signal - mirrors the roster-based approach already used by
// National Power Rankings elsewhere in this app, just reading the save's
// pre-computed team ratings directly instead of re-deriving them from every
// individual player.
function projectedOffenseScore(teams) {
    const overall = buildPercentileLookup(teams, t => t.ratingOff);
    const qb = buildPercentileLookup(teams, t => t.ratingQB);
    const rb = buildPercentileLookup(teams, t => t.ratingRB);
    const wr = buildPercentileLookup(teams, t => t.ratingWR);
    const te = buildPercentileLookup(teams, t => t.ratingTE);
    const ol = buildPercentileLookup(teams, t => t.ratingOL);
    return t => 0.6 * overall(t.ratingOff) + 0.4 * ((qb(t.ratingQB) + rb(t.ratingRB) + wr(t.ratingWR) + te(t.ratingTE) + ol(t.ratingOL)) / 5);
}
function projectedDefenseScore(teams) {
    const overall = buildPercentileLookup(teams, t => t.ratingDef);
    const dl = buildPercentileLookup(teams, t => t.ratingDL);
    const lb = buildPercentileLookup(teams, t => t.ratingLB);
    const db = buildPercentileLookup(teams, t => t.ratingDB);
    return t => 0.6 * overall(t.ratingDef) + 0.4 * ((dl(t.ratingDL) + lb(t.ratingLB) + db(t.ratingDB)) / 3);
}

/**
 * Scores and ranks Offense/Defense for whatever set of teams it's given -
 * factored out from computeTop25 so Conference Standings can call it with
 * just one conference's members and get ranks computed relative to THAT
 * group (percentiles are always relative to the input list), rather than
 * relative to all ~138 national teams. This is the one genuinely CALCULATED
 * ranking in both the Top 25 and Conference Standings tabs (see
 * OFFENSE_METRICS_PLAYED / DEFENSE_METRICS_PLAYED above for the exact
 * inputs) - everything else (poll ranks, composite rank, conference record
 * order) is either passed through from the save or a plain record sort.
 * Mutates nothing on the input objects; returns new objects with
 * isProjected/offenseScore/offenseRank/defenseScore/defenseRank attached.
 */
function computeOffenseDefenseRanks(teams) {
    if (!teams.length) return [];

    const played = teams.filter(t => t.gamesPlayed > 0);
    const projected = teams.filter(t => t.gamesPlayed === 0);
    const hasPoints = played.length > 0 && played.every(t => t.pointsFor != null);

    const offenseScorePlayed = played.length
        ? blendScore(played, hasPoints ? OFFENSE_METRICS_PLAYED : OFFENSE_METRICS_PLAYED_NO_POINTS)
        : null;
    const defenseScorePlayed = played.length
        ? blendScore(played, hasPoints ? DEFENSE_METRICS_PLAYED : DEFENSE_METRICS_PLAYED_NO_POINTS)
        : null;
    const offenseScoreProjected = projected.length ? projectedOffenseScore(projected) : null;
    const defenseScoreProjected = projected.length ? projectedDefenseScore(projected) : null;

    const scored = teams.map(t => {
        const isProjected = t.gamesPlayed === 0;
        const offenseScore = isProjected ? offenseScoreProjected(t) : offenseScorePlayed(t);
        const defenseScore = isProjected ? defenseScoreProjected(t) : defenseScorePlayed(t);
        return { ...t, isProjected, offenseScore, defenseScore };
    });

    const byOffense = [...scored].sort((a, b) => b.offenseScore - a.offenseScore);
    byOffense.forEach((t, i) => { t.offenseRank = i + 1; });
    const byDefense = [...scored].sort((a, b) => b.defenseScore - a.defenseScore);
    byDefense.forEach((t, i) => { t.defenseRank = i + 1; });

    return scored;
}

/**
 * Ranks a national list of teams (from parseNationalTeamStats) for the Top
 * 25. The poll-order fields (mediaRank/coachesRank/cfpRank) are passed
 * straight through from the save's own in-game polls, not derived from
 * anything here. compositeRank ("The Coordinator 25") is the one blended
 * field this module produces: the straight average of the save's Media and
 * Coaches poll ranks (both populated from preseason on), folding in the CFP
 * poll too once it's actually active (nonzero for at least one team - it
 * stays unranked league-wide until partway through a real season). Teams
 * with no poll data at all (a completed season predating this feature - see
 * parseNationalTeamStats) get compositeRank left null rather than a
 * fabricated number.
 * Returns every real team with offenseRank/defenseRank/compositeRank (plus
 * the raw mediaRank/coachesRank/cfpRank) attached - callers/the frontend
 * decide which field to sort/display by.
 */
function computeTop25(teams) {
    if (!teams.length) return [];

    const scored = computeOffenseDefenseRanks(teams).map(t => ({ ...t, compositeRank: null }));

    const cfpActive = scored.some(t => t.cfpRank > 0);
    const withPolls = scored.filter(t => t.mediaRank != null && t.coachesRank != null);
    withPolls.forEach(t => {
        const parts = [t.mediaRank, t.coachesRank];
        if (cfpActive && t.cfpRank > 0) parts.push(t.cfpRank);
        t.compositeScore = parts.reduce((a, b) => a + b, 0) / parts.length;
    });
    const byComposite = [...withPolls].sort((a, b) => a.compositeScore - b.compositeScore);
    byComposite.forEach((t, i) => { t.compositeRank = i + 1; });

    return scored;
}

/**
 * Ranks one conference's members for Conference Standings: offenseRank/
 * defenseRank are recomputed relative to just this conference (via
 * computeOffenseDefenseRanks above, not the national numbers). confRank is a
 * plain sort by conference win percentage (ties broken by conference wins,
 * then overall win percentage) - real conference standings are ordered by
 * conference record, not by any blended score. nationalRank is copied
 * through from each team's already-computed national compositeRank (from
 * computeTop25 on the full team list) for the "Rank (if applicable)" column,
 * left null/untouched if the caller didn't provide one.
 */
function computeConferenceStandings(conferenceTeams) {
    if (!conferenceTeams.length) return [];

    const scored = computeOffenseDefenseRanks(conferenceTeams);

    const confWinPct = t => {
        const g = (t.confWins || 0) + (t.confLosses || 0) + (t.confTies || 0);
        return g > 0 ? (t.confWins + 0.5 * t.confTies) / g : -1; // no conference games yet sorts last
    };
    const byConfRecord = [...scored].sort((a, b) => {
        const pctDiff = confWinPct(b) - confWinPct(a);
        if (pctDiff !== 0) return pctDiff;
        if ((b.confWins || 0) !== (a.confWins || 0)) return (b.confWins || 0) - (a.confWins || 0);
        return (b.wins || 0) - (a.wins || 0);
    });
    byConfRecord.forEach((t, i) => { t.confRank = i + 1; });

    return scored;
}

module.exports = { computeTop25, computeConferenceStandings, computeOffenseDefenseRanks };
