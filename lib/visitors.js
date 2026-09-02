const crypto = require('crypto');
const { getAuthDb } = require('./authDb');

// Non-identifying: just a random ID, no email/IP/fingerprint. Long-lived
// since it's an anonymous counter, not a login session - httpOnly because
// nothing on the page needs to read it, only the server.
const VISITOR_COOKIE_NAME = 'rc_visitor_id';
const VISITOR_COOKIE_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000; // ~2 years

function todayIso() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** At most one row per visitor per calendar day, via the unique index on
 *  (visitor_id, visit_date) - repeat page loads the same day are no-ops,
 *  so this stays "count of individual people," not a page-view counter. */
function recordVisitIfNew(visitorId) {
    const db = getAuthDb();
    db.prepare('INSERT OR IGNORE INTO site_visits (visitor_id, visit_date, created_at) VALUES (?, ?, ?)')
        .run(visitorId, todayIso(), new Date().toISOString());
}

/**
 * Express middleware: assigns/reads an anonymous visitor cookie and logs a
 * visit for real page loads only (not API calls, not static assets like
 * .css/.js/images) - so someone who only ever hits /login.html and never
 * creates an account still gets counted, which nothing else on the admin
 * tab currently captures. Caller (server.js) only mounts this in hosted
 * mode; there's no "site visitors" concept for a single local user.
 */
function trackVisit(req, res, next) {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    if (req.path !== '/' && !req.path.endsWith('.html')) return next();

    let visitorId = req.cookies && req.cookies[VISITOR_COOKIE_NAME];
    if (!visitorId) {
        visitorId = crypto.randomBytes(16).toString('hex');
        res.cookie(VISITOR_COOKIE_NAME, visitorId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: VISITOR_COOKIE_MAX_AGE_MS,
            path: '/'
        });
    }
    try {
        recordVisitIfNew(visitorId);
    } catch (err) {
        console.error('Failed to record site visit:', err);
    }
    next();
}

function totalUniqueVisitors() {
    const db = getAuthDb();
    return db.prepare('SELECT COUNT(DISTINCT visitor_id) AS n FROM site_visits').get().n;
}

function uniqueVisitorsSince(sinceIsoTimestamp) {
    const db = getAuthDb();
    return db.prepare('SELECT COUNT(DISTINCT visitor_id) AS n FROM site_visits WHERE created_at >= ?').get(sinceIsoTimestamp).n;
}

/** Same rationale/pattern as pruneOldUploadEvents in lib/adminStats.js -
 *  this table has no other cleanup, so without it disk usage on the
 *  persistent volume grows forever. Rows already cap at one per visitor
 *  per day, so this is a secondary bound on top of that. */
function pruneOldVisits(days) {
    const db = getAuthDb();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM site_visits WHERE created_at < ?').run(cutoff);
    return result.changes || 0;
}

module.exports = { VISITOR_COOKIE_NAME, trackVisit, totalUniqueVisitors, uniqueVisitorsSince, pruneOldVisits };
