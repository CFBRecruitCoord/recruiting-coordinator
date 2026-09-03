const { getAuthDb } = require('./authDb');

// Anonymous (not-logged-in) visitors get 3 free uploads before being asked
// to create an account - logged-in users have no limit at all. Only
// successful uploads count against the limit (a failed parse attempt
// shouldn't burn one of someone's 3 free tries).
const FREE_UPLOAD_LIMIT = 3;

/** How many successful uploads this anonymous visitor has on record.
 *  Returns 0 (no DB touched at all) if there's no visitor ID - covers both
 *  personal mode (trackVisit is never mounted there, so this cookie never
 *  exists) and the rare case of a real hosted visitor with cookies blocked. */
function countSuccessfulUploadsForVisitor(visitorId) {
    if (!visitorId) return 0;
    const db = getAuthDb();
    return db.prepare('SELECT COUNT(*) AS n FROM upload_events WHERE visitor_id = ? AND success = 1').get(visitorId).n;
}

module.exports = { FREE_UPLOAD_LIMIT, countSuccessfulUploadsForVisitor };
