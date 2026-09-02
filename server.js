const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FranchiseFile } = require('madden-franchise');
const { parseRecruits } = require('./lib/parseRecruits');
const { parseRosterLandscape } = require('./lib/parseRosterLandscape');
const { parseUserTeamContext } = require('./lib/parseUserTeamContext');
const { getConfig, setConfig } = require('./lib/config');
const {
    signup, verifyLogin, createSession, destroySession, getUserForSession,
    requireAuth, setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME
} = require('./lib/auth');
const { isAdmin, requireAdmin, recordUploadEvent, getAdminStats, pruneOldUploadEvents } = require('./lib/adminStats');
const {
    submitFeedback, listFeedbackForUser, listFeedback, updateFeedbackStatus, getFeedbackCounts
} = require('./lib/feedback');

const app = express();
const PORT = process.env.PORT || 4000;

// Off by default - this is still the plain personal-use local tool unless
// explicitly launched in hosted mode. When on: the app requires login, and
// the "refresh from a local file path" feature is disabled outright, since
// that path lives on the SERVER's disk - meaningless (and a path-traversal
// risk) once other people's save files live on their own computers instead.
// Trimmed + lowercased before comparing, so a stray space or "True"/"TRUE"
// typed into a hosting dashboard doesn't silently fall back to personal mode.
const MULTI_TENANT_MODE = String(process.env.MULTI_TENANT_MODE || '').trim().toLowerCase() === 'true';

// Store uploads in a temp dir; save files can be ~10MB so keep a generous limit.
// This is the OS's own temp directory, NOT the persistent volume - it's
// already wiped on every redeploy/restart, and every upload is unlinked
// immediately after parsing (success or failure - see the try/finally in
// /api/upload below) regardless of hosted vs. personal mode. The only real
// gap is a hard crash mid-request (e.g. the OOM crash this app has hit
// before) skipping that cleanup - sweepOrphanedUploads() below exists
// purely as a safety net for that one case, not because uploads normally
// stick around.
const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'recruiting-coordinator-uploads');
const upload = multer({
    dest: UPLOAD_TMP_DIR,
    limits: { fileSize: 100 * 1024 * 1024 }
});

// Deletes any leftover upload temp file older than an hour - a save file
// upload takes seconds to at most ~a minute even on the largest saves
// (see the OOM investigation notes elsewhere in this file), so anything
// still sitting here an hour later was orphaned by a crash before its own
// cleanup ran, not a slow request in progress.
const ORPHAN_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;
function sweepOrphanedUploads() {
    fs.readdir(UPLOAD_TMP_DIR, (err, files) => {
        if (err) return; // directory doesn't exist yet - nothing to sweep
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(UPLOAD_TMP_DIR, file);
            fs.stat(filePath, (statErr, stats) => {
                if (statErr) return;
                if (now - stats.mtimeMs > ORPHAN_UPLOAD_MAX_AGE_MS) {
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
}

app.use(cookieParser());
app.use(express.json());

// ---- Auth (always mounted, but meaningless/unused unless MULTI_TENANT_MODE) ----
app.post('/api/auth/signup', async (req, res) => {
    try {
        const user = await signup(req.body.email, req.body.password);
        const { token, expiresAt } = createSession(user.id);
        setSessionCookie(res, token, expiresAt);
        res.json({ id: user.id, email: user.email });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const user = await verifyLogin(req.body.email, req.body.password);
        if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
        const { token, expiresAt } = createSession(user.id);
        setSessionCookie(res, token, expiresAt);
        res.json({ id: user.id, email: user.email });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login failed.', details: err.message });
    }
});

app.post('/api/auth/logout', (req, res) => {
    destroySession(req.cookies && req.cookies[SESSION_COOKIE_NAME]);
    clearSessionCookie(res);
    res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
    const user = getUserForSession(req.cookies && req.cookies[SESSION_COOKIE_NAME]);
    // isAdmin is resolved server-side and just handed to the client as a
    // boolean - the admin email itself never needs to be known by the
    // frontend, and the real access control lives on /api/admin/stats
    // regardless of what this flag says.
    res.json({ user: user ? { ...user, isAdmin: isAdmin(user) } : null });
});

// Always requires real auth + the admin check, regardless of MULTI_TENANT_MODE
// (unlike most routes, which use apiGate and are wide open in personal mode) -
// admin data should never be reachable without genuinely being logged in as
// the admin. requireAdmin 404s rather than 403s for non-admins, so the
// endpoint's existence isn't revealed to a logged-in-but-not-admin user.
app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
    try {
        res.json(getAdminStats());
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load admin stats.', details: err.message });
    }
});

// Same admin-only gating as /api/admin/stats above - never reachable
// without being genuinely logged in as the admin, regardless of mode.
app.get('/api/admin/feedback', requireAuth, requireAdmin, (req, res) => {
    try {
        res.json({
            items: listFeedback({ status: req.query.status, type: req.query.type }),
            counts: getFeedbackCounts()
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load feedback.', details: err.message });
    }
});

app.post('/api/admin/feedback/:id/status', requireAuth, requireAdmin, (req, res) => {
    try {
        updateFeedbackStatus(req.params.id, req.body.status);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ---- The app itself: gated behind login only in hosted mode ----
function pageGate(req, res, next) {
    if (!MULTI_TENANT_MODE) return next();
    const user = getUserForSession(req.cookies && req.cookies[SESSION_COOKIE_NAME]);
    if (!user) return res.redirect('/login.html');
    next();
}

function apiGate(req, res, next) {
    if (!MULTI_TENANT_MODE) return next();
    return requireAuth(req, res, next);
}

app.get('/', pageGate, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// User-facing comment/bug report submission (the feedback.html page linked
// from the account bar). Gated like most routes - wide open in personal
// mode (harmless there, just a local row nobody reviews), real auth
// required in hosted mode so every submission is attributable to an account.
app.post('/api/feedback', apiGate, (req, res) => {
    try {
        submitFeedback({
            userId: req.user && req.user.id,
            type: req.body.type,
            message: req.body.message,
            pageContext: req.body.pageContext
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// A user's own submission history - never anyone else's, so this is safe
// to leave behind the same apiGate as everything else rather than requiring
// the stricter requireAdmin used by /api/admin/feedback above.
app.get('/api/feedback/mine', apiGate, (req, res) => {
    try {
        res.json({ items: req.user ? listFeedbackForUser(req.user.id) : [] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load your feedback.', details: err.message });
    }
});

app.post('/api/upload', apiGate, upload.single('saveFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        // Opened once and reused for both parses - a save file is large
        // enough (~10MB, tens of thousands of records) that re-opening it a
        // second time would roughly double load time for no benefit.
        const franchise = await FranchiseFile.create(req.file.path);
        const recruits = await parseRecruits(franchise);
        const roster = await parseRosterLandscape(franchise);
        const userTeam = await parseUserTeamContext(franchise);
        recordUploadEvent({
            userId: req.user && req.user.id,
            success: true,
            recruitCount: recruits.length,
            rosterCount: roster.length
        });
        res.json({ count: recruits.length, recruits, rosterCount: roster.length, roster, userTeam });
    } catch (err) {
        console.error(err);
        recordUploadEvent({ userId: req.user && req.user.id, success: false, errorMessage: err.message });
        res.status(500).json({ error: 'Failed to parse save file. Make sure this is a valid EA Sports College Football 27 dynasty save.', details: err.message });
    } finally {
        fs.unlink(req.file.path, () => {});
    }
});

// A local file path only means something on the machine actually running
// the server, so this whole "refresh from a saved path" feature is
// personal-use-only and disabled outright in hosted mode (also closes off
// what would otherwise be a path-traversal / arbitrary-file-read risk once
// multiple untrusted users share one server).
function localPathGate(req, res, next) {
    if (MULTI_TENANT_MODE) {
        return res.status(403).json({ error: 'Refreshing from a local file path is not available in hosted mode. Upload your save file instead.' });
    }
    next();
}

app.get('/api/config', localPathGate, (req, res) => {
    res.json(getConfig());
});

app.post('/api/config', localPathGate, (req, res) => {
    try {
        if (typeof req.body.savePath !== 'string' || !req.body.savePath.trim()) {
            return res.status(400).json({ error: 'savePath is required.' });
        }
        res.json(setConfig({ savePath: req.body.savePath.trim() }));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save config.', details: err.message });
    }
});

// Re-parse directly from the configured save file path - no re-upload
// needed, since the dynasty save always lives at the same location on disk.
app.post('/api/refresh', localPathGate, async (req, res) => {
    const { savePath } = getConfig();
    if (!savePath || !fs.existsSync(savePath)) {
        return res.status(400).json({ error: `Save file not found at: ${savePath || '(not set)'}` });
    }
    try {
        const franchise = await FranchiseFile.create(savePath);
        const recruits = await parseRecruits(franchise);
        const roster = await parseRosterLandscape(franchise);
        const userTeam = await parseUserTeamContext(franchise);
        res.json({ count: recruits.length, recruits, rosterCount: roster.length, roster, userTeam });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to refresh from save file.', details: err.message });
    }
});

// A try/catch around an `await` chain can only catch errors that properly
// reject a promise. If a dependency (e.g. madden-franchise doing raw file
// I/O internally) emits a stream 'error' event with no listener, or throws
// synchronously outside that chain, Node treats it as an uncaught exception
// and kills the WHOLE PROCESS - silently, with the client just seeing the
// connection die and zero response, which is exactly what "502 / connection
// closed unexpectedly" with no error in the app's own logs looks like. These
// handlers exist purely so that if that happens again, the real error and
// stack trace get printed before the process goes down, instead of nothing.
process.on('uncaughtException', err => {
    console.error('=== UNCAUGHT EXCEPTION (process will exit) ===');
    console.error(err);
    process.exit(1);
});
process.on('unhandledRejection', reason => {
    console.error('=== UNHANDLED PROMISE REJECTION ===');
    console.error(reason);
});

// ---- Storage upkeep, so disk usage on a hosted plan's persistent volume
// can't grow unbounded ----
// Uploaded save files themselves are never a concern here - they only ever
// touch the OS's own temp dir (wiped on every redeploy anyway, and
// unlinked immediately after each request regardless of outcome; see the
// try/finally in /api/upload). sweepOrphanedUploads() is just a safety net
// for the one way that cleanup can be skipped: a hard crash mid-request.
//
// The one thing on the actual persistent volume that has no other
// cleanup is the upload_events log in auth.db (sessions already
// self-expire; users/feedback are real product data, deliberately left
// alone). Run both sweeps once at startup - so a redeploy doesn't wait a
// full interval before the first cleanup - then on a recurring timer.
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const UPLOAD_EVENT_RETENTION_DAYS = 90;

sweepOrphanedUploads();
setInterval(sweepOrphanedUploads, ONE_HOUR_MS);

function pruneUploadEventsLog() {
    try {
        const deleted = pruneOldUploadEvents(UPLOAD_EVENT_RETENTION_DAYS);
        if (deleted > 0) console.log(`Pruned ${deleted} upload_events row(s) older than ${UPLOAD_EVENT_RETENTION_DAYS} days.`);
    } catch (err) {
        console.error('Failed to prune old upload_events rows:', err);
    }
}
// Hosted mode only - this table is only ever written to when there's a
// logged-in user (see recordUploadEvent's early return), so in personal
// mode auth.db never even gets created; running this unconditionally
// would create it anyway for nothing.
if (MULTI_TENANT_MODE) {
    pruneUploadEventsLog();
    setInterval(pruneUploadEventsLog, ONE_DAY_MS);
}

app.listen(PORT, () => {
    console.log(`Recruiting Coordinator running on port ${PORT}`);
    console.log(`Mode: ${MULTI_TENANT_MODE ? 'HOSTED (login required)' : 'PERSONAL (no login, local-path refresh enabled)'}`);
    console.log(`Raw MULTI_TENANT_MODE env value: ${JSON.stringify(process.env.MULTI_TENANT_MODE)}`);
    if (MULTI_TENANT_MODE) {
        console.log(`DATA_DIR: ${process.env.DATA_DIR || '(not set - using default in-repo path, will NOT survive a redeploy)'}`);
    }
});
