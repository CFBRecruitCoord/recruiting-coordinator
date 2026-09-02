const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getAuthDb } = require('./authDb');

const SESSION_COOKIE_NAME = 'rc_session';
const SESSION_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

/**
 * Creates a new account. Throws with a user-facing message on bad input or
 * an email that's already registered - never reveals *which* accounts exist
 * beyond that basic "already registered" signal on this exact form.
 */
async function signup(email, password) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_RE.test(normalized)) throw new Error('Please enter a valid email address.');
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');

    const db = getAuthDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
    if (existing) throw new Error('An account with that email already exists.');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO users (email, password_hash, created_at, subscription_status)
        VALUES (?, ?, ?, 'none')
    `).run(normalized, passwordHash, now);

    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalized);
    return user;
}

/**
 * Verifies credentials and returns the matching user, or null. Deliberately
 * returns the same "invalid email or password" outcome whether the email
 * doesn't exist or the password is wrong, so a login attempt can't be used
 * to enumerate registered accounts.
 */
async function verifyLogin(email, password) {
    const normalized = normalizeEmail(email);
    const db = getAuthDb();
    const row = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(normalized);
    if (!row) return null;

    const ok = await bcrypt.compare(password || '', row.password_hash);
    if (!ok) return null;

    return { id: row.id, email: row.email };
}

function createSession(userId) {
    const db = getAuthDb();
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    db.prepare(`
        INSERT INTO sessions (token, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
    `).run(token, userId, now.toISOString(), expiresAt.toISOString());

    return { token, expiresAt };
}

function destroySession(token) {
    if (!token) return;
    const db = getAuthDb();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Resolves a session token to its user, or null if missing/expired. Expired
 *  sessions are cleaned up lazily on lookup rather than needing a cron job. */
function getUserForSession(token) {
    if (!token) return null;
    const db = getAuthDb();
    const row = db.prepare(`
        SELECT u.id, u.email, u.subscription_status, u.trial_ends_at, s.expires_at
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
    `).get(token);
    if (!row) return null;

    if (new Date(row.expires_at) < new Date()) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        return null;
    }

    return {
        id: row.id, email: row.email,
        subscriptionStatus: row.subscription_status,
        trialEndsAt: row.trial_ends_at
    };
}

/** Express middleware: attaches req.user if a valid session cookie is
 *  present, otherwise responds 401. Mount only on routes that require login. */
function requireAuth(req, res, next) {
    const token = req.cookies && req.cookies[SESSION_COOKIE_NAME];
    const user = getUserForSession(token);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    req.user = user;
    next();
}

function setSessionCookie(res, token, expiresAt) {
    res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: expiresAt,
        path: '/'
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

module.exports = {
    signup, verifyLogin, createSession, destroySession, getUserForSession,
    requireAuth, setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME
};
