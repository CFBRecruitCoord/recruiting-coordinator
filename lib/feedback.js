const { getAuthDb } = require('./authDb');

const VALID_TYPES = new Set(['comment', 'bug']);
const VALID_STATUSES = new Set(['new', 'reviewed', 'resolved']);
const MAX_MESSAGE_LENGTH = 5000;

/**
 * Records one comment/bug report. userId is nullable (e.g. a stale session
 * somehow reached this route) - the row still gets kept rather than
 * dropped, just with no attributable user.
 */
function submitFeedback({ userId, type, message, pageContext }) {
    if (!VALID_TYPES.has(type)) throw new Error('type must be "comment" or "bug".');
    const trimmed = String(message || '').trim();
    if (!trimmed) throw new Error('Message is required.');

    const db = getAuthDb();
    db.prepare(`
        INSERT INTO feedback (user_id, type, message, page_context, status, created_at)
        VALUES (?, ?, ?, ?, 'new', ?)
    `).run(userId ?? null, type, trimmed.slice(0, MAX_MESSAGE_LENGTH), pageContext || null, new Date().toISOString());
}

/** A user's own submissions only - never anyone else's, this isn't an
 *  admin-gated route. */
function listFeedbackForUser(userId) {
    if (!userId) return [];
    const db = getAuthDb();
    return db.prepare(`
        SELECT id, type, message, page_context AS pageContext, status, created_at AS createdAt
        FROM feedback WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId);
}

/** Admin-only view across everyone's submissions, optionally filtered. */
function listFeedback({ status, type } = {}) {
    const db = getAuthDb();
    let query = `
        SELECT f.id, f.type, f.message, f.page_context AS pageContext, f.status,
               f.created_at AS createdAt, u.email AS email
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
    `;
    const conditions = [];
    const params = [];
    if (status && VALID_STATUSES.has(status)) { conditions.push('f.status = ?'); params.push(status); }
    if (type && VALID_TYPES.has(type)) { conditions.push('f.type = ?'); params.push(type); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY f.created_at DESC LIMIT 200';
    return db.prepare(query).all(...params);
}

function updateFeedbackStatus(id, status) {
    if (!VALID_STATUSES.has(status)) throw new Error('Invalid status.');
    const db = getAuthDb();
    db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, id);
}

function getFeedbackCounts() {
    const db = getAuthDb();
    const total = db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n;
    const newCount = db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'").get().n;
    const bugCount = db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE type = 'bug'").get().n;
    const commentCount = db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE type = 'comment'").get().n;
    return { total, newCount, bugCount, commentCount };
}

module.exports = {
    VALID_TYPES, VALID_STATUSES,
    submitFeedback, listFeedbackForUser, listFeedback, updateFeedbackStatus, getFeedbackCounts
};
