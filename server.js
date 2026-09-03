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
const { trackVisit, pruneOldVisits, VISITOR_COOKIE_NAME } = require('./lib/visitors');
const { FREE_UPLOAD_LIMIT, countSuccessfulUploadsForVisitor } = require('./lib/uploadLimits');

const app = express();
const PORT = process.env.PORT || 4000;

// Off by default - this is still the plain personal-use local tool unless
// explicitly launched in hosted mode. When on: usage stats get tracked, the
// admin tab becomes reachable (to the one admin account), and the "refresh
// from a local file path" feature is disabled outright, since that path
// lives on the SERVER's disk - meaningless (and a path-traversal risk) once
// other people's save files live on their own computers instead.
//
// Login/signup is NOT required to use the app - it's fully optional (see
// the account bar), used only for things that genuinely need an account:
// admin access, and leaving feedback/bug reports. pageGate/apiGate below
// used to redirect/block everyone without a session; they're now
// deliberately no-ops for exactly that reason, kept (rather than deleted)
// as the obvious place to reintroduce a login requirement for a specific
// feature later, without having to rebuild this plumbing from scratch.
//
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

// Anonymous unique-visitor counter for the admin tab (see lib/visitors.js).
// Mounted before pageGate/static so it still counts someone who gets
// redirected straight to /login.html, or who loads login.html/signup.html
// directly without ever creating an account. Hosted mode only - there's no
// "visitors" concept for a single local user, and running it in personal
// mode would create auth.db just to hold an unused table.
if (MULTI_TENANT_MODE) {
    app.use(trackVisit);
}

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
    //
    // hostedMode tells the frontend whether to show the account bar at all
    // (Log In / Sign Up when logged out, email / Log out when logged in) -
    // in personal mode there's no login system exposed in the UI, so the
    // bar needs to stay fully hidden rather than show a "Log In" prompt
    // that leads nowhere useful.
    res.json({ user: user ? { ...user, isAdmin: isAdmin(user) } : null, hostedMode: MULTI_TENANT_MODE });
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

// ---- The app itself: no longer requires login in any mode ----
// Deliberately a no-op now (see the MULTI_TENANT_MODE comment above for
// why it's kept rather than removed) - the app page loads for everyone.
function pageGate(req, res, next) {
    next();
}

// Never blocks the request, but still attaches req.user when a valid
// session IS present, so a logged-in user's uploads/activity keep getting
// attributed to their account. An anonymous visitor just proceeds with no
// req.user - every route already treats that as optional (e.g. `req.user
// && req.user.id`), the same as personal mode has always worked.
function apiGate(req, res, next) {
    const user = getUserForSession(req.cookies && req.cookies[SESSION_COOKIE_NAME]);
    if (user) req.user = user;
    next();
}

app.get('/', pageGate, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// User-facing comment/bug report submission (the feedback.html page linked
// from the account bar). Unlike the rest of the app, this still requires a
// real account - a deliberate choice (feedback needs to be attributable to
// someone), and the one feature that still gives someone a reason to sign
// up now that everything else is open.
app.post('/api/feedback', requireAuth, (req, res) => {
    try {
        submitFeedback({
            userId: req.user.id,
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
// to leave behind plain requireAuth rather than the stricter requireAdmin
// used by /api/admin/feedback above.
app.get('/api/feedback/mine', requireAuth, (req, res) => {
    try {
        res.json({ items: listFeedbackForUser(req.user.id) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load your feedback.', details: err.message });
    }
});

// Blocks an anonymous visitor's 4th+ upload attempt, before multer even
// reads the file off the wire - logged-in users (req.user set by apiGate,
// which runs first) are exempt entirely. Mounted ahead of upload.single()
// deliberately: the expensive part of this route is the save-file parse
// below, not accepting the upload, so there's no reason to let a blocked
// request pay any of that cost.
function checkUploadLimit(req, res, next) {
    if (req.user) return next();
    const visitorId = req.cookies && req.cookies[VISITOR_COOKIE_NAME];
    const used = countSuccessfulUploadsForVisitor(visitorId);
    if (used >= FREE_UPLOAD_LIMIT) {
        return res.status(403).json({
            error: 'account_required',
            message: `You've used all ${FREE_UPLOAD_LIMIT} free uploads. Create a free account (or log in) to keep using Recruiting Coordinator.`,
            freeUploadLimit: FREE_UPLOAD_LIMIT
        });
    }
    next();
}

app.post('/api/upload', apiGate, checkUploadLimit, upload.single('saveFile'), async (req, res) => {
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
        // Most uploaders won't be logged in now that it's optional - fall
        // back to the anonymous visitor cookie (same one the unique-visitor
        // counter uses) so the admin usage dashboard doesn't go dark.
        const visitorId = req.cookies && req.cookies[VISITOR_COOKIE_NAME];
        recordUploadEvent({
            userId: req.user && req.user.id,
            visitorId,
            success: true,
            recruitCount: recruits.length,
            rosterCount: roster.length
        });
        // Lets the frontend show a heads-up right when an anonymous visitor
        // crosses the free limit, rather than waiting for their next
        // attempt to get blocked by checkUploadLimit above. null for a
        // logged-in user, who has no limit to warn about.
        const freeUploadInfo = req.user ? null : { used: countSuccessfulUploadsForVisitor(visitorId), limit: FREE_UPLOAD_LIMIT };
        res.json({ count: recruits.length, recruits, rosterCount: roster.length, roster, userTeam, freeUploadInfo });
    } catch (err) {
        console.error(err);
        recordUploadEvent({
            userId: req.user && req.user.id,
            visitorId: req.cookies && req.cookies[VISITOR_COOKIE_NAME],
            success: false,
            errorMessage: err.message
        });
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
// The things on the actual persistent volume that have no other cleanup
// are the upload_events log and the site_visits log in auth.db (sessions
// already self-expire; users/feedback are real product data, deliberately
// left alone). Run both sweeps once at startup - so a redeploy doesn't
// wait a full interval before the first cleanup - then on a recurring timer.
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const UPLOAD_EVENT_RETENTION_DAYS = 90;
const SITE_VISIT_RETENTION_DAYS = 90;

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
function pruneSiteVisitsLog() {
    try {
        const deleted = pruneOldVisits(SITE_VISIT_RETENTION_DAYS);
        if (deleted > 0) console.log(`Pruned ${deleted} site_visits row(s) older than ${SITE_VISIT_RETENTION_DAYS} days.`);
    } catch (err) {
        console.error('Failed to prune old site_visits rows:', err);
    }
}
// Hosted mode only - these tables are only ever written to in hosted mode
// (recordUploadEvent no-ops without a logged-in user, and trackVisit is
// never mounted at all in personal mode - see above), so auth.db never
// even gets created there; running this unconditionally would create it
// anyway for nothing.
if (MULTI_TENANT_MODE) {
    pruneUploadEventsLog();
    setInterval(pruneUploadEventsLog, ONE_DAY_MS);
    pruneSiteVisitsLog();
    setInterval(pruneSiteVisitsLog, ONE_DAY_MS);
}

app.listen(PORT, () => {
    console.log(`Recruiting Coordinator running on port ${PORT}`);
    console.log(`Mode: ${MULTI_TENANT_MODE ? 'HOSTED (login optional, usage stats tracked)' : 'PERSONAL (no login, local-path refresh enabled)'}`);
    console.log(`Raw MULTI_TENANT_MODE env value: ${JSON.stringify(process.env.MULTI_TENANT_MODE)}`);
    if (MULTI_TENANT_MODE) {
        console.log(`DATA_DIR: ${process.env.DATA_DIR || '(not set - using default in-repo path, will NOT survive a redeploy)'}`);
    }
});
