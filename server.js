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
const upload = multer({
    dest: path.join(os.tmpdir(), 'recruiting-coordinator-uploads'),
    limits: { fileSize: 100 * 1024 * 1024 }
});

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
    res.json({ user });
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
        res.json({ count: recruits.length, recruits, rosterCount: roster.length, roster, userTeam });
    } catch (err) {
        console.error(err);
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

app.listen(PORT, () => {
    console.log(`Recruiting Coordinator running on port ${PORT}`);
    console.log(`Mode: ${MULTI_TENANT_MODE ? 'HOSTED (login required)' : 'PERSONAL (no login, local-path refresh enabled)'}`);
    console.log(`Raw MULTI_TENANT_MODE env value: ${JSON.stringify(process.env.MULTI_TENANT_MODE)}`);
    if (MULTI_TENANT_MODE) {
        console.log(`DATA_DIR: ${process.env.DATA_DIR || '(not set - using default in-repo path, will NOT survive a redeploy)'}`);
    }
});
