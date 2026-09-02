const { getAuthDb } = require('./authDb');

// Hardcoded rather than a DB flag/role column on purpose - there's exactly
// one admin, and a config file or role system would be more moving parts
// than this actually needs right now.
const ADMIN_EMAIL = 'drew.l.edwards@gmail.com';

function isAdmin(user) {
    return !!user && user.email && user.email.toLowerCase() === ADMIN_EMAIL;
}

/** Express middleware: 404s (not 403) for non-admins, so the endpoint's
 *  existence isn't even revealed to a logged-in-but-not-admin user poking
 *  at the API directly. Must run after requireAuth (needs req.user). */
function requireAdmin(req, res, next) {
    if (!isAdmin(req.user)) return res.status(404).json({ error: 'Not found.' });
    next();
}

/** Logs one upload attempt (success or failure) - just counts/metadata for
 *  the admin tab, never the parsed save contents. No-op if there's no
 *  logged-in user (e.g. personal/non-hosted mode), since usage stats for a
 *  single local user aren't meaningful. */
function recordUploadEvent({ userId, success, recruitCount, rosterCount, errorMessage }) {
    if (!userId) return;
    const db = getAuthDb();
    db.prepare(`
        INSERT INTO upload_events (user_id, created_at, success, recruit_count, roster_count, error_message)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, new Date().toISOString(), success ? 1 : 0, recruitCount ?? null, rosterCount ?? null, errorMessage ?? null);
}

function sinceIso(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function getAdminStats() {
    const db = getAuthDb();

    const totalUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const totalUploads = db.prepare('SELECT COUNT(*) AS n FROM upload_events WHERE success = 1').get().n;
    const totalFailedUploads = db.prepare('SELECT COUNT(*) AS n FROM upload_events WHERE success = 0').get().n;

    const windows = [1, 7, 30].map(days => {
        const since = sinceIso(days);
        return {
            days,
            newUsers: db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?').get(since).n,
            uploads: db.prepare('SELECT COUNT(*) AS n FROM upload_events WHERE success = 1 AND created_at >= ?').get(since).n
        };
    });

    const activeSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at >= ?').get(new Date().toISOString()).n;

    const recentSignups = db.prepare(`
        SELECT email, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 20
    `).all();

    const recentUploads = db.prepare(`
        SELECT u.email AS email, e.created_at AS createdAt, e.success AS success,
               e.recruit_count AS recruitCount, e.roster_count AS rosterCount, e.error_message AS errorMessage
        FROM upload_events e
        LEFT JOIN users u ON u.id = e.user_id
        ORDER BY e.created_at DESC LIMIT 20
    `).all();

    return {
        totalUsers, totalUploads, totalFailedUploads, activeSessions,
        windows,
        recentSignups,
        recentUploads: recentUploads.map(r => ({ ...r, success: !!r.success }))
    };
}

module.exports = { ADMIN_EMAIL, isAdmin, requireAdmin, recordUploadEvent, getAdminStats };
