(function () {
    // ---- Account bar: only ever shown in hosted (MULTI_TENANT_MODE)
    // deployments - personal mode has no login system in the UI at all, so
    // it stays fully hidden there rather than show a "Log In" prompt that
    // leads nowhere useful. Login itself is optional now (the app works
    // without an account), so this shows one of two states in hosted mode:
    // "Log In / Sign Up" when logged out, or "email + Log out" when in. ----
    (async function initAccountBar() {
        const bar = document.getElementById('accountBar');
        const emailEl = document.getElementById('accountEmail');
        const logoutBtn = document.getElementById('logoutBtn');
        const adminTabBtn = document.getElementById('adminTabBtn');
        const loggedInRow = document.getElementById('accountBarLoggedIn');
        const loggedOutRow = document.getElementById('accountBarLoggedOut');
        if (!bar) return;
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            if (!data.hostedMode) return; // personal mode - leave everything hidden

            bar.classList.remove('hidden');
            if (data.user) {
                loggedInRow.classList.remove('hidden');
                loggedOutRow.classList.add('hidden');
                emailEl.textContent = data.user.email;
                // The tab button is just a convenience toggle - the real
                // access control is server-side (isAdmin is resolved by the
                // server, and /api/admin/stats independently enforces it),
                // so there's nothing sensitive about revealing this client-side.
                if (data.user.isAdmin && adminTabBtn) {
                    adminTabBtn.classList.remove('hidden');
                    loadAdminStats();
                    loadAdminFeedback();
                }
            } else {
                loggedInRow.classList.add('hidden');
                loggedOutRow.classList.remove('hidden');
            }
        } catch (e) { /* request failed - leave hidden */ }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                // Login is optional now, so there's nowhere the app needs to
                // force someone after logging out - back to the app itself,
                // not the login page.
                window.location.href = '/';
            });
        }
    })();

    // ---- Free-upload-limit modal ----
    // Shared by two triggers in uploadFile() below: a heads-up right when an
    // anonymous visitor's upload crosses the free limit (server still lets
    // that one through), and again if they try another upload afterward
    // without an account (server blocks it with error: 'account_required').
    // Dismissing never grants a bypass - it's just "ok, I understand," not
    // a real gate; the actual enforcement is entirely server-side.
    const accountModal = document.getElementById('accountRequiredModal');
    const accountModalIcon = document.getElementById('accountModalIcon');
    const accountModalTitle = document.getElementById('accountModalTitle');
    const accountModalMessage = document.getElementById('accountModalMessage');

    function showAccountModal({ icon, title, message }) {
        if (!accountModal) return;
        accountModalIcon.textContent = icon || '🔒';
        accountModalTitle.textContent = title;
        accountModalMessage.textContent = message;
        accountModal.classList.remove('hidden');
    }
    function hideAccountModal() {
        if (accountModal) accountModal.classList.add('hidden');
    }

    const accountModalClose = document.getElementById('accountModalClose');
    const accountModalDismiss = document.getElementById('accountModalDismiss');
    if (accountModalClose) accountModalClose.addEventListener('click', hideAccountModal);
    if (accountModalDismiss) accountModalDismiss.addEventListener('click', hideAccountModal);
    if (accountModal) accountModal.addEventListener('click', e => {
        if (e.target === accountModal) hideAccountModal(); // clicked the backdrop, not the card
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && accountModal && !accountModal.classList.contains('hidden')) hideAccountModal();
    });

    // ---- Landing hero ----
    // Visible by default (no "hidden" class in the HTML) - it's the "no
    // data loaded yet" state. Hidden the moment a save file loads
    // successfully, on every fresh page load alike (there's no localStorage
    // flag here unlike the welcome modal below - a brand-new browser tab
    // always starts with empty allRecruits, so it always starts by showing
    // this until something actually loads).
    const landingHero = document.getElementById('landingHero');
    function hideLandingHero() {
        if (landingHero) landingHero.classList.add('hidden');
    }

    // ---- Welcome/overview modal ----
    // Shown once, right after someone's first-ever successful upload
    // (either path: drag-and-drop/browse via uploadFile(), or the personal-
    // mode "Refresh from Save File" button) - a quick "you're in, here's
    // what's here" orientation, not a repeat-every-time thing. Remembered
    // via localStorage rather than a server flag, since it's purely a
    // per-browser UI nicety with no need to sync across devices/accounts.
    const WELCOME_MODAL_SEEN_KEY = 'rc_welcome_seen_v1';
    const welcomeModal = document.getElementById('welcomeModal');

    function showWelcomeModal() {
        if (welcomeModal) welcomeModal.classList.remove('hidden');
    }
    function hideWelcomeModal() {
        if (welcomeModal) welcomeModal.classList.add('hidden');
    }
    function maybeShowWelcomeModal() {
        let alreadySeen = true;
        try { alreadySeen = localStorage.getItem(WELCOME_MODAL_SEEN_KEY) === 'true'; } catch (e) { /* storage inaccessible - treat as already seen rather than nagging every load */ }
        if (alreadySeen) return;
        try { localStorage.setItem(WELCOME_MODAL_SEEN_KEY, 'true'); } catch (e) { /* nothing to do if storage is blocked */ }
        showWelcomeModal();
    }

    const welcomeModalClose = document.getElementById('welcomeModalClose');
    const welcomeModalDismiss = document.getElementById('welcomeModalDismiss');
    if (welcomeModalClose) welcomeModalClose.addEventListener('click', hideWelcomeModal);
    if (welcomeModalDismiss) welcomeModalDismiss.addEventListener('click', hideWelcomeModal);
    if (welcomeModal) welcomeModal.addEventListener('click', e => {
        if (e.target === welcomeModal) hideWelcomeModal(); // clicked the backdrop, not the card
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && welcomeModal && !welcomeModal.classList.contains('hidden')) hideWelcomeModal();
    });

    const PAGE_SIZE = 25;

    // Canonical display order for the Class Landscape table - offense,
    // then defense, then specialists - rather than alphabetical, which reads
    // strangely for football positions.
    const POSITION_ORDER = [
        'QB', 'HB', 'FB', 'WR', 'TE',
        'LT', 'LG', 'C', 'RG', 'RT',
        'LE', 'RE', 'DT',
        'LOLB', 'MLB', 'ROLB',
        'CB', 'FS', 'SS',
        'K', 'P'
    ];

    // Recruits only carry six measurable ratings (no throw power, catching,
    // etc. - those only exist on rostered players, not prospects), so "key
    // ratings pertinent to the position" means highlighting which of those
    // six matter most for each position rather than hiding the others.
    const KEY_STATS_BY_POSITION = {
        QB: ['awareness', 'agility', 'speed'],
        HB: ['speed', 'agility', 'acceleration'],
        FB: ['strength', 'speed', 'awareness'],
        WR: ['speed', 'agility', 'jumping'],
        TE: ['speed', 'strength', 'awareness'],
        LT: ['strength', 'awareness'], LG: ['strength', 'awareness'], C: ['strength', 'awareness'],
        RG: ['strength', 'awareness'], RT: ['strength', 'awareness'],
        LE: ['strength', 'speed'], RE: ['strength', 'speed'], DT: ['strength', 'speed'],
        LOLB: ['speed', 'strength', 'awareness'], MLB: ['speed', 'strength', 'awareness'], ROLB: ['speed', 'strength', 'awareness'],
        CB: ['speed', 'agility', 'jumping'],
        FS: ['speed', 'awareness', 'jumping'], SS: ['speed', 'awareness', 'jumping'],
        K: ['awareness'], P: ['awareness']
    };

    // Rostered players expose real position-specific ratings (unlike
    // recruits), so National Landscape uses a richer, more specific set for
    // its "Key Rating" columns instead of just highlighting generic athletic numbers.
    const KEY_STATS_ROSTER = {
        QB: [['awareness', 'Awareness'], ['throwPower', 'Throw Power'], ['throwAccuracy', 'Throw Accuracy']],
        HB: [['speed', 'Speed'], ['agility', 'Agility'], ['acceleration', 'Acceleration']],
        FB: [['strength', 'Strength'], ['runBlock', 'Run Block'], ['awareness', 'Awareness']],
        WR: [['speed', 'Speed'], ['catching', 'Catching'], ['jumping', 'Jumping']],
        TE: [['catching', 'Catching'], ['runBlock', 'Run Block'], ['strength', 'Strength']],
        LT: [['strength', 'Strength'], ['passBlock', 'Pass Block'], ['runBlock', 'Run Block']],
        LG: [['strength', 'Strength'], ['passBlock', 'Pass Block'], ['runBlock', 'Run Block']],
        C: [['strength', 'Strength'], ['passBlock', 'Pass Block'], ['runBlock', 'Run Block']],
        RG: [['strength', 'Strength'], ['passBlock', 'Pass Block'], ['runBlock', 'Run Block']],
        RT: [['strength', 'Strength'], ['passBlock', 'Pass Block'], ['runBlock', 'Run Block']],
        LE: [['strength', 'Strength'], ['tackle', 'Tackle'], ['speed', 'Speed']],
        RE: [['strength', 'Strength'], ['tackle', 'Tackle'], ['speed', 'Speed']],
        DT: [['strength', 'Strength'], ['tackle', 'Tackle'], ['speed', 'Speed']],
        LOLB: [['speed', 'Speed'], ['tackle', 'Tackle'], ['awareness', 'Awareness']],
        MLB: [['speed', 'Speed'], ['tackle', 'Tackle'], ['awareness', 'Awareness']],
        ROLB: [['speed', 'Speed'], ['tackle', 'Tackle'], ['awareness', 'Awareness']],
        CB: [['speed', 'Speed'], ['manCoverage', 'Man Coverage'], ['jumping', 'Jumping']],
        FS: [['speed', 'Speed'], ['manCoverage', 'Man Coverage'], ['awareness', 'Awareness']],
        SS: [['speed', 'Speed'], ['manCoverage', 'Man Coverage'], ['awareness', 'Awareness']],
        K: [['awareness', 'Awareness']],
        P: [['awareness', 'Awareness']]
    };

    const SCHOOL_YEAR_ORDER = ['Freshman', 'Sophomore', 'Junior', 'Senior'];
    // Best-caliber tier first, matching the "highest first" convention used
    // everywhere else. Boundaries mirror lib/parseRosterLandscape.js on the
    // server - four roughly-even groups of the save's 138 teams.
    const PRESTIGE_TIERS = [
        { tier: 4, label: 'Championship Caliber (7-10)' },
        { tier: 3, label: 'Contending (5-6)' },
        { tier: 2, label: 'Competing (3-4)' },
        { tier: 1, label: 'Rebuilding (0-2)' }
    ];

    // Grouped positions for the Top Teams tab. A team's score for a group is
    // the average of its starter-weighted Overall at EACH individual position
    // in the group (not all players pooled together), so e.g. Offensive Line
    // reflects all five spots evenly. A position the team has nobody at is
    // simply left out of that average rather than counted as a zero.
    const STARTER_WEIGHT = 3;
    const POSITION_GROUPS_META = [
        { key: 'QB', label: 'Quarterback', positions: ['QB'] },
        { key: 'RB', label: 'Running Back', positions: ['HB', 'FB'] },
        { key: 'WR', label: 'Wide Receiver', positions: ['WR'] },
        { key: 'TE', label: 'Tight End', positions: ['TE'] },
        { key: 'OL', label: 'Offensive Line', positions: ['LT', 'LG', 'C', 'RG', 'RT'] },
        { key: 'DL', label: 'Defensive Line', positions: ['LE', 'RE', 'DT'] },
        { key: 'LB', label: 'Linebacker', positions: ['LOLB', 'MLB', 'ROLB'] },
        { key: 'DB', label: 'Defensive Back', positions: ['CB', 'FS', 'SS'] },
        { key: 'K', label: 'Kicker', positions: ['K'] },
        { key: 'P', label: 'Punter', positions: ['P'] }
    ];

    // Only groups with multiple distinct positions get a per-position
    // breakdown column - single-position groups (QB, WR, TE, K, P) and RB
    // (which averages down to just HB in practice for most rosters) show
    // just the blended group score instead.
    const SHOW_BREAKDOWN_GROUPS = new Set(['OL', 'DL', 'LB', 'DB']);
    const POSITION_FULL_NAMES = {
        LT: 'Left Tackle', LG: 'Left Guard', C: 'Center', RG: 'Right Guard', RT: 'Right Tackle',
        LE: 'Left End', RE: 'Right End', DT: 'Defensive Tackle',
        LOLB: 'Left Outside Linebacker', MLB: 'Middle Linebacker', ROLB: 'Right Outside Linebacker',
        CB: 'Cornerback', FS: 'Free Safety', SS: 'Strong Safety'
    };

    let allRecruits = [];
    let allRosterPlayers = [];
    let userTeamContext = null;
    let filteredSorted = [];
    let currentPage = 0;
    let sortKey = 'nilAdjustedRating';
    let sortDir = 'desc';

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const uploadStatus = document.getElementById('uploadStatus');
    const resultsPanel = document.getElementById('resultsPanel');
    const tableBody = document.getElementById('tableBody');
    const rangeSelect = document.getElementById('rangeSelect');
    const posFilter = document.getElementById('posFilter');
    const starFilter = document.getElementById('starFilter');
    const stateFilter = document.getElementById('stateFilter');
    const schoolFilter = document.getElementById('schoolFilter');
    const searchBox = document.getElementById('searchBox');
    const resultCount = document.getElementById('resultCount');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pagerLabel = document.getElementById('pagerLabel');
    const recruitTable = document.getElementById('recruitTable');
    const blurToggle = document.getElementById('blurToggle');
    const avgStarFilter = document.getElementById('avgStarFilter');
    const averagesBody = document.getElementById('averagesBody');
    const matrixPositionSelect = document.getElementById('matrixPositionSelect');
    const matrixStartersOnly = document.getElementById('matrixStartersOnly');
    const matrixBody = document.getElementById('matrixBody');
    const rosterPositionFilter = document.getElementById('rosterPositionFilter');
    const rosterTierFilter = document.getElementById('rosterTierFilter');
    const rosterStartersOnly = document.getElementById('rosterStartersOnly');
    const rosterBody = document.getElementById('rosterBody');
    const tierLegend = document.getElementById('tierLegend');
    const topTeamsContainer = document.getElementById('topTeamsContainer');
    const powerRankings = document.getElementById('powerRankings');
    const targetsTitle = document.getElementById('targetsTitle');
    const teamContextSummary = document.getElementById('teamContextSummary');
    const targetsContainer = document.getElementById('targetsContainer');

    // ---- One-click refresh from a configured save file path ----
    const refreshPanel = document.getElementById('refreshPanel');
    const refreshBtn = document.getElementById('refreshBtn');
    const savePathText = document.getElementById('savePathText');
    const editPathBtn = document.getElementById('editPathBtn');
    const savePathEditor = document.getElementById('savePathEditor');
    const savePathInput = document.getElementById('savePathInput');
    const savePathBtn = document.getElementById('savePathBtn');
    const cancelPathBtn = document.getElementById('cancelPathBtn');
    const manualUploadDetails = document.getElementById('manualUploadDetails');
    const pathSetupPrompt = document.getElementById('pathSetupPrompt');
    const pathSetupInput = document.getElementById('pathSetupInput');
    const pathSetupSaveBtn = document.getElementById('pathSetupSaveBtn');
    const pathSetupSkipBtn = document.getElementById('pathSetupSkipBtn');

    let currentSavePath = '';
    let pathPromptDismissed = false;

    // ---- Upload handling ----
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) uploadFile(fileInput.files[0]);
    });

    function setStatus(msg, cls) {
        uploadStatus.textContent = msg;
        uploadStatus.className = 'upload-status' + (cls ? ' ' + cls : '');
    }

    async function uploadFile(file) {
        setStatus(`Parsing ${file.name}... this can take a few seconds for large saves.`, 'loading');
        const formData = new FormData();
        formData.append('saveFile', file);

        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });

            // Read as text first rather than assuming JSON - a platform-level
            // failure (timeout, out-of-memory crash, proxy error) often
            // returns an HTML error page or a differently-shaped body
            // instead of the JSON my own server code always returns, and
            // res.json() would otherwise throw a confusing "Unexpected
            // token" error that hides what actually happened.
            const rawText = await res.text();
            let data;
            try { data = JSON.parse(rawText); } catch (e) { data = null; }

            if (!res.ok) {
                // Blocked by checkUploadLimit on the server (4th+ anonymous
                // upload attempt) - show the account modal instead of the
                // generic error text, since "here's what to do about it" is
                // the whole point here, not just "it failed."
                if (data && data.error === 'account_required') {
                    showAccountModal({
                        icon: '🔒',
                        title: 'Account required to continue',
                        message: data.message || `You've used your uploads without an account. Create an account (or log in) to keep going.`
                    });
                    setStatus('Create an account to keep uploading.', 'error');
                    return;
                }
                const detail = (data && data.error) || rawText.slice(0, 200) || `HTTP ${res.status}`;
                throw new Error(`Upload failed (HTTP ${res.status}): ${detail}`);
            }
            if (!data) throw new Error('Upload failed: server returned an unexpected (non-JSON) response.');

            allRecruits = data.recruits;
            allRosterPlayers = data.roster || [];
            userTeamContext = data.userTeam || null;
            recomputeEffectiveRatings();
            setStatus(`Loaded ${data.count} recruits and ${data.rosterCount || 0} rostered players from ${file.name}.`, 'success');
            resultsPanel.classList.remove('hidden');
            populateFilterOptions();
            applyFiltersAndSort();
            computeAndRenderAverages();
            renderMatrixTable();
            renderRosterTable();
            renderTopTeamsTable();
            renderPowerRankings();
            renderRecruitTargets();
            hideLandingHero();
            loadCoachingCareer();
            loadRecruitingClasses();
            loadNotablePlayers();
            loadTop25();
            loadConfStandings();
            loadAwards();
            maybeShowWelcomeModal();

            // First successful upload ever (no refresh path configured yet):
            // offer to remember this file's location so future updates are a
            // single click instead of a re-upload.
            if (!currentSavePath && !pathPromptDismissed) {
                pathSetupInput.value = file.path || ''; // browsers usually don't expose this; harmless if empty
                pathSetupPrompt.classList.remove('hidden');
            }

            // Heads-up the moment an anonymous visitor crosses the free
            // limit, rather than waiting for their next upload to get
            // blocked by the server. null for a logged-in user (no limit).
            if (data.freeUploadInfo && data.freeUploadInfo.used >= data.freeUploadInfo.limit) {
                showAccountModal({
                    icon: '🎉',
                    title: `That's ${data.freeUploadInfo.limit} uploads without an account!`,
                    message: `Create an account to keep using Dynasty Coordinator - it only takes a few seconds.`
                });
            }
        } catch (err) {
            console.error(err);
            setStatus(err.message || 'Something went wrong parsing the save file.', 'error');
        }
    }

    // ---- One-click refresh setup ----
    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            const config = await res.json();
            currentSavePath = config.savePath || '';
            if (currentSavePath) showRefreshPanel();
        } catch (err) {
            console.error(err);
        }
    }

    function showRefreshPanel() {
        savePathText.textContent = currentSavePath;
        refreshPanel.classList.remove('hidden');
        manualUploadDetails.removeAttribute('open');
        pathSetupPrompt.classList.add('hidden');
    }

    editPathBtn.addEventListener('click', () => {
        savePathInput.value = currentSavePath;
        savePathEditor.classList.remove('hidden');
    });
    cancelPathBtn.addEventListener('click', () => savePathEditor.classList.add('hidden'));

    savePathBtn.addEventListener('click', async () => {
        const newPath = savePathInput.value.trim();
        if (!newPath) return;
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ savePath: newPath })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save path');
            currentSavePath = data.savePath;
            savePathText.textContent = currentSavePath;
            savePathEditor.classList.add('hidden');
        } catch (err) {
            console.error(err);
            setStatus(err.message, 'error');
        }
    });

    pathSetupSaveBtn.addEventListener('click', async () => {
        const newPath = pathSetupInput.value.trim();
        if (!newPath) return;
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ savePath: newPath })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save path');
            currentSavePath = data.savePath;
            showRefreshPanel();
        } catch (err) {
            console.error(err);
            setStatus(err.message, 'error');
        }
    });

    pathSetupSkipBtn.addEventListener('click', () => {
        pathPromptDismissed = true;
        pathSetupPrompt.classList.add('hidden');
    });

    refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        setStatus('Refreshing from save file... this can take a few seconds.', 'loading');
        try {
            const res = await fetch('/api/refresh', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Refresh failed');

            allRecruits = data.recruits;
            allRosterPlayers = data.roster || [];
            userTeamContext = data.userTeam || null;
            recomputeEffectiveRatings();
            setStatus(`Loaded ${data.count} recruits and ${data.rosterCount || 0} rostered players from the configured save file.`, 'success');
            resultsPanel.classList.remove('hidden');
            populateFilterOptions();
            applyFiltersAndSort();
            computeAndRenderAverages();
            renderMatrixTable();
            renderRosterTable();
            renderTopTeamsTable();
            renderPowerRankings();
            renderRecruitTargets();
            hideLandingHero();
            loadCoachingCareer();
            loadRecruitingClasses();
            loadNotablePlayers();
            loadTop25();
            loadConfStandings();
            loadAwards();
            maybeShowWelcomeModal();
        } catch (err) {
            console.error(err);
            setStatus(err.message || 'Something went wrong refreshing from the save file.', 'error');
        } finally {
            refreshBtn.disabled = false;
        }
    });

    // ---- Blur toggle (default ON every time the program opens) ----
    function applyBlurState() {
        recruitTable.classList.toggle('blur-ratings', blurToggle.checked);
    }
    blurToggle.addEventListener('change', applyBlurState);
    applyBlurState();

    loadConfig();

    // ================= TABS =================
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            // Lazy-loaded on first visit rather than at page load, since it's
            // independent of whatever's been uploaded this session - also
            // reloaded after every successful upload (see uploadFile/refreshBtn)
            // so it stays current without needing a dedicated refresh button.
            if (btn.dataset.tab === 'coachingCareerTab') { loadCoachingCareer(); loadRecruitingClasses(); loadNotablePlayers(); }
            if (btn.dataset.tab === 'nationalTab') { loadTop25(); loadConfStandings(); loadAwards(); }
        });
    });

    // Sub-tabs (pill style: Recruit Explorer/Class Landscape/etc. under
    // Recruiting Coordinator, Top 25/National Power Rankings under National
    // Landscape, Usage Stats/Feedback under Admin, Rivalries & Records under
    // Coaching Career) - same active-swap pattern as the top-level tabs
    // above, just scoped one level down. Deliberately scoped to the
    // enclosing .tab-panel (not a page-wide querySelectorAll) - now that more
    // than one top-level tab has its own switchable sub-tab group, a global
    // active-swap would clear another tab's sub-tab selection (e.g. clicking
    // a National Landscape sub-tab would deactivate every Recruiting
    // Coordinator sub-tab too, leaving nothing visible there on switching back).
    document.querySelectorAll('.sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const scope = btn.closest('.tab-panel') || document;
            scope.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            scope.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.subtab).classList.add('active');
        });
    });

    // Third-level nav (Every School/Bowl Games/Playoffs, inside Rivalries &
    // Records) - deliberately different, non-hyphenated class names
    // (.subtabs/.subtab-btn) from .sub-tabs/.sub-tab-btn above, purely so
    // the two levels of nesting stay visually and structurally distinct.
    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.subtab).classList.add('active');
        });
    });

    // ================= CLASS LANDSCAPE TAB =================
    avgStarFilter.addEventListener('change', computeAndRenderAverages);

    function computeAndRenderAverages() {
        if (!allRecruits.length) {
            averagesBody.innerHTML = '<tr><td colspan="10" class="empty-row">Upload a save file to see the class landscape.</td></tr>';
            return;
        }

        const star = avgStarFilter.value;
        const filtered = star ? allRecruits.filter(r => String(r.starsNum) === star) : allRecruits;

        const byPosition = new Map();
        filtered.forEach(r => {
            if (!byPosition.has(r.position)) byPosition.set(r.position, []);
            byPosition.get(r.position).push(r);
        });

        if (!byPosition.size) {
            averagesBody.innerHTML = '<tr><td colspan="10" class="empty-row">No recruits match this filter.</td></tr>';
            return;
        }

        const avg = (arr, key) => arr.reduce((sum, r) => sum + (Number(r[key]) || 0), 0) / arr.length;
        // A recruit's individual NIL value is floored at 0 before averaging,
        // so a position stacked with below-baseline NIL prospects (Fullback,
        // Kicker, Punter) reads as "0 expected" rather than a confusing
        // negative number - it never drags positive prospects' NIL down below zero.
        const avgNil = arr => arr.reduce((sum, r) => sum + Math.max(0, Number(r.nil) || 0), 0) / arr.length;

        // Highest average Overall always leads the table; a fixed offense/
        // defense/specialist order is used only to break exact ties deterministically.
        const positions = [...byPosition.keys()].sort((a, b) => {
            const overallDiff = avg(byPosition.get(b), 'overall') - avg(byPosition.get(a), 'overall');
            if (Math.abs(overallDiff) > 0.001) return overallDiff;
            const ia = POSITION_ORDER.indexOf(a), ib = POSITION_ORDER.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });

        averagesBody.innerHTML = positions.map(pos => {
            const group = byPosition.get(pos);
            const keyStats = KEY_STATS_BY_POSITION[pos] || [];
            const statCell = statKey => {
                const cls = keyStats.includes(statKey) ? 'key-stat' : '';
                return `<td class="${cls}">${avg(group, statKey).toFixed(1)}</td>`;
            };

            return `
                <tr>
                    <td class="name-cell">${pos}</td>
                    <td>${group.length}</td>
                    <td class="key-stat">${avg(group, 'overall').toFixed(1)}</td>
                    ${statCell('speed')}
                    ${statCell('strength')}
                    ${statCell('awareness')}
                    ${statCell('agility')}
                    ${statCell('acceleration')}
                    ${statCell('jumping')}
                    <td>${Math.round(avgNil(group))}</td>
                </tr>
            `;
        }).join('');
    }

    // ================= NATIONAL LANDSCAPE TAB =================
    // Static list of positions - doesn't depend on loaded data, so it's
    // populated once at startup rather than every time roster data loads.
    matrixPositionSelect.innerHTML = POSITION_ORDER.map(p => `<option value="${p}">${p}</option>`).join('');
    rosterPositionFilter.innerHTML = '<option value="">All Positions</option>' +
        POSITION_ORDER.map(p => `<option value="${p}">${p}</option>`).join('');

    matrixPositionSelect.addEventListener('change', renderMatrixTable);
    matrixStartersOnly.addEventListener('change', renderMatrixTable);
    rosterPositionFilter.addEventListener('change', renderRosterTable);
    rosterTierFilter.addEventListener('change', renderRosterTable);
    rosterStartersOnly.addEventListener('change', renderRosterTable);

    const avgOverall = arr => arr.reduce((sum, p) => sum + (Number(p.overall) || 0), 0) / arr.length;
    const avgStat = (arr, key) => arr.reduce((sum, p) => sum + (Number(p[key]) || 0), 0) / arr.length;

    // Four recognizable example teams per tier (highest-prestige within that
    // tier), shown above the "All Positions, by Class" table so the tier
    // labels aren't just abstract names - you can see who's actually in them.
    function renderTierLegend() {
        if (!allRosterPlayers.length) { tierLegend.innerHTML = ''; return; }

        const teamsByName = new Map();
        allRosterPlayers.forEach(p => {
            if (!teamsByName.has(p.teamName)) {
                teamsByName.set(p.teamName, { name: p.teamName, prestige: p.teamPrestige, tier: p.prestigeTier });
            }
        });
        const teams = [...teamsByName.values()];

        tierLegend.innerHTML = PRESTIGE_TIERS.map(({ tier, label }) => {
            const examples = teams.filter(t => t.tier === tier)
                .sort((a, b) => b.prestige - a.prestige)
                .slice(0, 4)
                .map(t => escapeHtml(t.name));
            return `<div class="tier-legend-row"><span class="tier-legend-label">${label}:</span> ${examples.join(', ') || '&mdash;'}</div>`;
        }).join('');
    }

    function renderMatrixTable() {
        if (!allRosterPlayers.length) {
            matrixBody.innerHTML = '<tr><td colspan="5" class="empty-row">Upload a save file to see the national landscape.</td></tr>';
            return;
        }

        const position = matrixPositionSelect.value || POSITION_ORDER[0];
        const startersOnly = matrixStartersOnly.value === 'starters';
        const pool = allRosterPlayers.filter(p => p.position === position && (!startersOnly || p.isStarter));

        matrixBody.innerHTML = PRESTIGE_TIERS.map(({ tier, label }) => {
            const cells = SCHOOL_YEAR_ORDER.map(year => {
                const group = pool.filter(p => p.prestigeTier === tier && p.schoolYear === year);
                if (!group.length) return `<td class="empty-cell">&mdash;</td>`;
                return `<td class="key-stat">${avgOverall(group).toFixed(1)} <span class="cell-count">(${group.length})</span></td>`;
            }).join('');
            return `<tr><td class="name-cell">${label}</td>${cells}</tr>`;
        }).join('');
    }

    function renderRosterTable() {
        renderTierLegend();

        if (!allRosterPlayers.length) {
            rosterBody.innerHTML = '<tr><td colspan="6" class="empty-row">Upload a save file to see the national landscape.</td></tr>';
            return;
        }

        const position = rosterPositionFilter.value;
        const tier = rosterTierFilter.value;
        const startersOnly = rosterStartersOnly.value === 'starters';
        const filtered = allRosterPlayers.filter(p =>
            (!position || p.position === position) &&
            (!tier || String(p.prestigeTier) === tier) &&
            (!startersOnly || p.isStarter)
        );

        if (!filtered.length) {
            rosterBody.innerHTML = '<tr><td colspan="6" class="empty-row">No players match this filter.</td></tr>';
            return;
        }

        const byPosClass = new Map();
        filtered.forEach(p => {
            const key = `${p.position}|${p.schoolYear}`;
            if (!byPosClass.has(key)) byPosClass.set(key, []);
            byPosClass.get(key).push(p);
        });

        const rows = [...byPosClass.keys()].sort((a, b) => {
            const [posA, yearA] = a.split('|');
            const [posB, yearB] = b.split('|');
            const ia = POSITION_ORDER.indexOf(posA), ib = POSITION_ORDER.indexOf(posB);
            if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            return SCHOOL_YEAR_ORDER.indexOf(yearA) - SCHOOL_YEAR_ORDER.indexOf(yearB);
        });

        rosterBody.innerHTML = rows.map(key => {
            const [pos, year] = key.split('|');
            const group = byPosClass.get(key);
            const keyStats = KEY_STATS_ROSTER[pos] || [];
            const keyCells = [0, 1, 2].map(i => {
                if (!keyStats[i]) return '<td>&mdash;</td>';
                const [statKey, label] = keyStats[i];
                return `<td class="key-stat"><span class="cell-count">${label}</span> ${avgStat(group, statKey).toFixed(1)}</td>`;
            }).join('');

            return `
                <tr>
                    <td class="name-cell">${pos}</td>
                    <td>${year}</td>
                    <td class="key-stat">${avgOverall(group).toFixed(1)}</td>
                    ${keyCells}
                </tr>
            `;
        }).join('');
    }

    // ================= TOP TEAMS TAB =================
    function weightedAvgOverall(players) {
        let sumWeighted = 0, sumWeights = 0;
        players.forEach(p => {
            const w = p.isStarter ? STARTER_WEIGHT : 1;
            sumWeighted += p.overall * w;
            sumWeights += w;
        });
        return sumWeights > 0 ? sumWeighted / sumWeights : null;
    }

    function computeAllTeamsForGroup(groupKey) {
        const meta = POSITION_GROUPS_META.find(g => g.key === groupKey);
        if (!meta) return [];

        const byTeam = new Map();
        allRosterPlayers.forEach(p => {
            if (!meta.positions.includes(p.position)) return;
            if (!byTeam.has(p.teamName)) {
                byTeam.set(p.teamName, {
                    teamName: p.teamName, teamMascot: p.teamMascot, teamAbbr: p.teamAbbr,
                    teamColorPrimary: p.teamColorPrimary, teamColorSecondary: p.teamColorSecondary,
                    prestigeTierLabel: p.prestigeTierLabel, byPosition: new Map()
                });
            }
            const team = byTeam.get(p.teamName);
            if (!team.byPosition.has(p.position)) team.byPosition.set(p.position, []);
            team.byPosition.get(p.position).push(p);
        });

        const teams = [];
        byTeam.forEach(team => {
            // Only positions the team actually has players at contribute to
            // the average - a missing position (e.g. no Fullback) is skipped
            // entirely rather than counted as a zero.
            const positionAverages = [];
            meta.positions.forEach(pos => {
                const players = team.byPosition.get(pos);
                if (!players || !players.length) return;
                positionAverages.push({ position: pos, avg: weightedAvgOverall(players) });
            });
            if (!positionAverages.length) return; // team has nobody at all in this group

            const groupScore = positionAverages.reduce((sum, x) => sum + x.avg, 0) / positionAverages.length;
            teams.push({ ...team, groupScore, positionAverages });
        });

        return teams;
    }

    function computeTopTeamsForGroup(groupKey) {
        return computeAllTeamsForGroup(groupKey).sort((a, b) => b.groupScore - a.groupScore).slice(0, 5);
    }

    const OFFENSE_GROUPS = ['QB', 'RB', 'WR', 'TE', 'OL'];
    const DEFENSE_GROUPS = ['DL', 'LB', 'DB'];
    const OVERALL_GROUPS = POSITION_GROUPS_META.map(g => g.key); // all ten groups

    // Blends several position groups' scores into one category score per
    // team (e.g. Offense = average of QB/RB/WR/TE/OL group scores). Same
    // "don't penalize missing data" rule applies one level up: a group the
    // team has no score for at all is simply left out of the blend.
    function computeTopTeamsForCategory(groupKeys) {
        const byTeam = new Map();
        groupKeys.forEach(key => {
            computeAllTeamsForGroup(key).forEach(t => {
                if (!byTeam.has(t.teamName)) {
                    byTeam.set(t.teamName, {
                        teamName: t.teamName, teamMascot: t.teamMascot, teamAbbr: t.teamAbbr,
                        teamColorPrimary: t.teamColorPrimary, teamColorSecondary: t.teamColorSecondary,
                        prestigeTierLabel: t.prestigeTierLabel, scores: []
                    });
                }
                byTeam.get(t.teamName).scores.push(t.groupScore);
            });
        });

        const teams = [];
        byTeam.forEach(team => {
            if (!team.scores.length) return;
            const categoryScore = team.scores.reduce((sum, s) => sum + s, 0) / team.scores.length;
            teams.push({ ...team, categoryScore });
        });

        teams.sort((a, b) => b.categoryScore - a.categoryScore);
        return teams.slice(0, 5);
    }

    const RANK_MEDALS = ['🥇', '🥈', '🥉'];

    function powerCard(team, i, groupKeys) {
        const abbr = team.teamAbbr || team.teamName.slice(0, 3).toUpperCase();
        const rankLabel = RANK_MEDALS[i] || `#${i + 1}`;
        const glow = (team.teamColorPrimary || '') + '4d'; // ~30% opacity hex alpha
        return `
            <div class="power-card clickable-row ${i === 0 ? 'rank-1' : ''}" style="--card-color:${team.teamColorPrimary || 'var(--accent)'}; --card-glow:${glow};" data-team="${escapeAttr(team.teamName)}" data-groups="${groupKeys.join(',')}">
                <div class="power-rank">${rankLabel}</div>
                <div class="power-swatch" style="background:${team.teamColorPrimary || '#333'}; color:${team.teamColorSecondary || '#fff'};">${escapeHtml(abbr)}</div>
                <div class="power-info">
                    <div class="power-team-name">${escapeHtml(team.teamName)}</div>
                    <div class="power-team-mascot">${escapeHtml(team.teamMascot || '')} &middot; ${team.prestigeTierLabel}</div>
                </div>
                <div class="power-score">${team.categoryScore.toFixed(1)}</div>
            </div>
        `;
    }

    function renderPowerRankings() {
        if (!allRosterPlayers.length) {
            powerRankings.innerHTML = '<p class="empty-row">Upload a save file to see power rankings.</p>';
            return;
        }

        const categories = [
            { title: '⚔️ Offense', groupKeys: OFFENSE_GROUPS, teams: computeTopTeamsForCategory(OFFENSE_GROUPS) },
            { title: '🛡️ Defense', groupKeys: DEFENSE_GROUPS, teams: computeTopTeamsForCategory(DEFENSE_GROUPS) },
            { title: '🏈 Overall', groupKeys: OVERALL_GROUPS, teams: computeTopTeamsForCategory(OVERALL_GROUPS) }
        ];

        powerRankings.innerHTML = categories.map(cat => `
            <div class="power-category">
                <h2 class="power-category-title">${cat.title}</h2>
                <div class="power-cards">
                    ${cat.teams.length ? cat.teams.map((t, i) => powerCard(t, i, cat.groupKeys)).join('') : '<p class="empty-row">No data.</p>'}
                </div>
            </div>
        `).join('');
    }

    function teamBadge(team) {
        const abbr = team.teamAbbr || team.teamName.slice(0, 3).toUpperCase();
        return `
            <span class="school-badge">
                <span class="badge-swatch" style="background:${team.teamColorPrimary || '#333'}; color:${team.teamColorSecondary || '#fff'};">${escapeHtml(abbr)}</span>
                <span>
                    <span class="name-cell">${escapeHtml(team.teamName)}</span>
                    <span class="school-mascot">${escapeHtml(team.teamMascot || '')}</span>
                </span>
            </span>
        `;
    }

    function renderTopTeamsTable() {
        if (!allRosterPlayers.length) {
            topTeamsContainer.innerHTML = '<p class="empty-row">Upload a save file to see top teams.</p>';
            return;
        }

        topTeamsContainer.innerHTML = POSITION_GROUPS_META.map(meta => {
            const teams = computeTopTeamsForGroup(meta.key);
            const showBreakdown = SHOW_BREAKDOWN_GROUPS.has(meta.key);
            const breakdownCount = showBreakdown ? meta.positions.length : 0;
            const colCount = 4 + breakdownCount;

            const headerCells = showBreakdown
                ? meta.positions.map(pos => `<th>${POSITION_FULL_NAMES[pos] || pos}</th>`).join('')
                : '';

            const bodyRows = !teams.length
                ? `<tr><td colspan="${colCount}" class="empty-row">No teams have any players at this position group.</td></tr>`
                : teams.map((team, i) => {
                    const posCells = showBreakdown
                        ? meta.positions.map(pos => {
                            const entry = team.positionAverages.find(x => x.position === pos);
                            return entry ? `<td class="key-stat">${entry.avg.toFixed(1)}</td>` : '<td>&mdash;</td>';
                        }).join('')
                        : '';

                    return `
                        <tr class="team-row clickable-row" data-team="${escapeAttr(team.teamName)}" data-groups="${meta.key}" data-colspan="${colCount}">
                            <td class="rank-cell">#${i + 1}</td>
                            <td>${teamBadge(team)}<span class="expand-hint">click for top players &rsaquo;</span></td>
                            <td>${team.prestigeTierLabel}</td>
                            <td class="key-stat">${team.groupScore.toFixed(1)}</td>
                            ${posCells}
                        </tr>
                    `;
                }).join('');

            return `
                <div class="top-teams-group">
                    <h2>${meta.label}</h2>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Rank</th><th>Team</th><th>Team Tier</th><th>Group Score</th>
                                    ${headerCells}
                                </tr>
                            </thead>
                            <tbody>${bodyRows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ---- Click a team (row or power card) to reveal its top 1-3 players at
    // that position set, with a few key ratings each. ----
    function getTopPlayersForTeam(teamName, groupKeys, limit) {
        const positions = groupKeys.flatMap(key => {
            const meta = POSITION_GROUPS_META.find(g => g.key === key);
            return meta ? meta.positions : [];
        });
        return allRosterPlayers
            .filter(p => p.teamName === teamName && positions.includes(p.position))
            .sort((a, b) => b.overall - a.overall)
            .slice(0, limit || 3);
    }

    function playerDetailCards(players) {
        if (!players.length) {
            return '<div class="player-detail-empty">No players found at this position set.</div>';
        }
        return players.map(p => {
            const keyStats = KEY_STATS_ROSTER[p.position] || [];
            const statsHtml = keyStats.map(([key, label]) =>
                `<span class="pd-stat"><span class="pd-stat-label">${label}</span> ${Number(p[key]).toFixed(1)}</span>`
            ).join('') || '<span class="pd-stat pd-stat-none">No position-specific ratings available</span>';

            return `
                <div class="player-detail-card">
                    <div class="pd-header">
                        <span class="pd-name">${escapeHtml(p.name)}</span>
                        <span class="pd-pos">${POSITION_FULL_NAMES[p.position] || p.position}</span>
                        ${p.isStarter ? '<span class="pd-starter">Starter</span>' : ''}
                    </div>
                    <div class="pd-meta">${p.schoolYear} &middot; Overall ${p.overall}</div>
                    <div class="pd-stats">${statsHtml}</div>
                </div>
            `;
        }).join('');
    }

    // Event delegation - one listener per container handles every team row/
    // card, including ones added on future re-renders, and toggles an
    // inline detail panel right after whichever one was clicked.
    topTeamsContainer.addEventListener('click', e => {
        const row = e.target.closest('.team-row');
        if (!row) return;

        const next = row.nextElementSibling;
        if (next && next.classList.contains('detail-row')) {
            next.remove();
            row.classList.remove('expanded');
            return;
        }

        const players = getTopPlayersForTeam(row.dataset.team, row.dataset.groups.split(','), 3);
        const detailHtml = `
            <tr class="detail-row">
                <td colspan="${row.dataset.colspan}">
                    <div class="player-detail-panel">${playerDetailCards(players)}</div>
                </td>
            </tr>
        `;
        row.insertAdjacentHTML('afterend', detailHtml);
        row.classList.add('expanded');
    });

    powerRankings.addEventListener('click', e => {
        const card = e.target.closest('.power-card');
        if (!card) return;

        const next = card.nextElementSibling;
        if (next && next.classList.contains('detail-row')) {
            next.remove();
            card.classList.remove('expanded');
            return;
        }

        const players = getTopPlayersForTeam(card.dataset.team, card.dataset.groups.split(','), 3);
        card.insertAdjacentHTML('afterend', `<div class="player-detail-panel detail-row">${playerDetailCards(players)}</div>`);
        card.classList.add('expanded');
    });

    // ================= RECRUIT TARGETS TAB =================
    // Fullback, Kicker, and Punter are excluded from the board entirely -
    // not scored, not recommended, regardless of need.
    const EXCLUDED_TARGET_POSITIONS = new Set(['FB', 'K', 'P']);

    // Realistic per-position roster sizes, used to flag depth shortages that
    // pure "quality gap" and "succession risk" scoring wouldn't otherwise
    // catch (e.g. a position with fine starters but nobody behind them).
    const EXPECTED_DEPTH_BY_POSITION = {
        QB: 3, HB: 4, WR: 8, TE: 3,
        LT: 3, LG: 3, C: 2, RG: 3, RT: 3,
        LE: 3, RE: 3, DT: 4,
        LOLB: 3, MLB: 3, ROLB: 3,
        CB: 6, FS: 3, SS: 3
    };
    const ALL_RAW_POSITIONS = Object.keys(EXPECTED_DEPTH_BY_POSITION);

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // Ordinal percentile (0-100): every item gets a unique rank slot instead
    // of averaging ties, so the many recruits that share an identical
    // rawRating/nilAdjustment to one decimal place don't all collapse into
    // one shared percentile value.
    function ordinalPercentiles(items, valueFn) {
        const withIdx = items.map((item, i) => ({ i, value: valueFn(item) }));
        withIdx.sort((a, b) => a.value - b.value);
        const n = withIdx.length;
        const byIndex = new Array(n);
        withIdx.forEach((entry, rank) => { byIndex[entry.i] = n > 1 ? (rank / (n - 1)) * 100 : 100; });
        return byIndex;
    }

    // One need score (0-100) per position: how big the talent gap is vs. the
    // national average at that spot, how much of the current starting group
    // is about to graduate (Junior/Senior), and whether the roster is even
    // deep enough there at all.
    function computePositionNeeds() {
        const needs = new Map();
        if (!userTeamContext) return needs;

        ALL_RAW_POSITIONS.forEach(pos => {
            const myPlayers = allRosterPlayers.filter(p => p.teamName === userTeamContext.name && p.position === pos);
            const nationalPlayers = allRosterPlayers.filter(p => p.position === pos);

            const myAvg = myPlayers.length ? weightedAvgOverall(myPlayers) : 0;
            const nationalAvg = nationalPlayers.length ? weightedAvgOverall(nationalPlayers) : myAvg;

            const qualityGap = Math.max(0, nationalAvg - myAvg);
            const qualityGapScore = clamp((qualityGap / 25) * 100, 0, 100);

            const starters = myPlayers.filter(p => p.isStarter);
            const graduatingStarters = starters.filter(p => p.schoolYear === 'Senior' || p.schoolYear === 'Junior');
            const successionRiskScore = (starters.length ? graduatingStarters.length / starters.length : 1) * 100;

            const expectedDepth = EXPECTED_DEPTH_BY_POSITION[pos] || 3;
            const depthDeficiencyScore = clamp(((expectedDepth - myPlayers.length) / expectedDepth) * 100, 0, 100);

            const needScore = clamp(
                0.45 * qualityGapScore + 0.35 * successionRiskScore + 0.20 * depthDeficiencyScore, 0, 100
            );

            needs.set(pos, {
                needScore, myAvg, nationalAvg,
                rosterCount: myPlayers.length, starterCount: starters.length,
                graduatingStarters: graduatingStarters.length
            });
        });

        return needs;
    }

    // Home state is the strongest geographic signal; failing that, a state
    // where the program has an established recruiting pipeline still helps.
    // Pipeline influence values run roughly 5-325 in this save, so /3.5 maps
    // that range onto a comparable 0-100 scale rather than 0-1.
    function geoFitScore(recruit) {
        if (!userTeamContext || !recruit.homeState) return { score: 0, label: null };
        if (recruit.homeState === userTeamContext.state) return { score: 100, label: 'Home State' };
        const pipelineValue = (userTeamContext.pipelineByState || {})[recruit.homeState];
        if (pipelineValue) return { score: clamp(pipelineValue / 3.5, 0, 100), label: 'Pipeline State' };
        return { score: 0, label: null };
    }

    // ---- Coordinator Settings -> Recruit Targets wiring ----
    // Team Direction changes two things at once: (1) how many of the 35
    // total board slots go to each tier, and (2) a small nudge to each
    // tier's own formula, shifting weight away from raw talent and toward
    // whichever term represents "long-term fit" in that formula (NIL for
    // Program Movers/Foundational; Need for Day One, which has no NIL term
    // at all). Maintain is the original, untouched baseline. All three
    // directions still total exactly 35 recruits.
    const TEAM_DIRECTION_TIER_SIZES = {
        rebuild: { dayOne: 3, programMovers: 8, foundational: 24 },
        maintain: { dayOne: 5, programMovers: 10, foundational: 20 },
        competeNow: { dayOne: 9, programMovers: 12, foundational: 14 }
    };
    const TEAM_DIRECTION_WEIGHT_NUDGE = { rebuild: 0.05, maintain: 0, competeNow: -0.05 };

    // Position Priorities adjustments are intentionally small relative to
    // the core scoring above (need/talent/NIL routinely swing candidates by
    // tens of points) - enough to break ties and nudge the order, never
    // enough by themselves to turn a poor team-fit into a top pick or push
    // a great team-fit off the board. Per the explicit product requirement,
    // these NEVER exclude a recruit outright - only add or subtract points.
    const ATTRIBUTE_BONUS_MAX = 6; // summed across up to 2 selected attributes, so +/-3 each
    const ARCHETYPE_BONUS = 5;     // matches one of the up-to-2 preferred archetypes
    const ARCHETYPE_PENALTY = 5;   // matches the one archetype flagged to avoid

    // "Ignore Gem/Bust Status" strips the Gem/Bust adjustment back out of
    // every calculation that uses it. The server always sends rawRating/
    // nilAdjustedRating WITH a Gem's +0.5 baked in (see parseRecruits.js;
    // Busts were never a rawRating penalty to begin with, so there's nothing
    // to remove there), so these Effective variants are recomputed here on
    // the client rather than re-uploading - subtract the recruit's own
    // gemBonus back out when the toggle is on, leave it untouched otherwise.
    // Called once whenever recruit data loads and again any time the toggle
    // changes, so every reader (table display/sort, talent percentiles,
    // Recruit Targets' own gemAdj term) sees a consistent, current value.
    function recomputeEffectiveRatings() {
        const ignore = coordinatorSettings.ignoreGemBustStatus;
        allRecruits.forEach(r => {
            r.rawRatingEffective = ignore ? +(r.rawRating - (r.gemBonus || 0)).toFixed(2) : r.rawRating;
            r.nilAdjustedRatingEffective = +(r.rawRatingEffective + r.nilAdjustment).toFixed(2);
        });
    }

    function computeRecruitTargetCandidates() {
        if (!allRecruits.length || !userTeamContext) return [];

        // Excluded positions are dropped before percentiles are computed, not
        // just filtered out of the final board - otherwise their presence
        // would still shift where everyone else lands in the ranking.
        const eligibleRecruits = allRecruits.filter(r => !EXCLUDED_TARGET_POSITIONS.has(r.position));

        const positionNeeds = computePositionNeeds();
        const talentPercentiles = ordinalPercentiles(eligibleRecruits, r => r.rawRatingEffective);
        const nilPercentiles = ordinalPercentiles(eligibleRecruits, r => r.nilAdjustment);

        // Position-scoped attribute percentiles, built lazily per position+
        // attribute actually selected as a priority - "excels at Strength"
        // for a Guard is judged against other eligible Guards, not the whole
        // recruit pool. Cached as recruit-object -> percentile maps so the
        // lookup is correct regardless of iteration order.
        const recruitsByPosition = {};
        eligibleRecruits.forEach(r => (recruitsByPosition[r.position] = recruitsByPosition[r.position] || []).push(r));
        const attrPercentileCache = {};
        function attrPercentileMapFor(pos, attrKey) {
            const cacheKey = pos + '|' + attrKey;
            if (!attrPercentileCache[cacheKey]) {
                const list = recruitsByPosition[pos] || [];
                const percentiles = ordinalPercentiles(list, r => r[attrKey] || 0);
                const map = new Map();
                list.forEach((r, idx) => map.set(r, percentiles[idx]));
                attrPercentileCache[cacheKey] = map;
            }
            return attrPercentileCache[cacheKey];
        }

        const direction = coordinatorSettings.teamDirection || 'maintain';
        const nudge = TEAM_DIRECTION_WEIGHT_NUDGE[direction] || 0;

        return eligibleRecruits.map((r, i) => {
            const need = positionNeeds.get(r.position) || { needScore: 0 };
            const geo = geoFitScore(r);
            const interestScore = r.userTeamInterest != null ? clamp(r.userTeamInterest, 0, 100) : 0;
            const gemAdj = coordinatorSettings.ignoreGemBustStatus ? 0 : (r.gem === 'GEM' ? 8 : (r.gem === 'BUST' ? -8 : 0));
            const talentPercentile = talentPercentiles[i];
            const nilPercentile = nilPercentiles[i];

            // --- Position Priorities: small additive bonus/penalty only ---
            const posSettings = coordinatorSettings.positions[r.position];
            let attributeBonus = 0;
            let archetypeAdj = 0;
            if (posSettings) {
                [posSettings.attr1, posSettings.attr2].forEach(attrKey => {
                    if (!attrKey) return;
                    const pct = attrPercentileMapFor(r.position, attrKey).get(r);
                    if (pct == null) return;
                    // Centered on the position's own 50th percentile, so a
                    // merely-average recruit at that attribute gets ~0.
                    attributeBonus += ((pct - 50) / 50) * (ATTRIBUTE_BONUS_MAX / 2);
                });
                if (r.archetype && (r.archetype === posSettings.archetype1 || r.archetype === posSettings.archetype2)) {
                    archetypeAdj += ARCHETYPE_BONUS;
                }
                if (r.archetype && posSettings.avoidArchetype && r.archetype === posSettings.avoidArchetype) {
                    archetypeAdj -= ARCHETYPE_PENALTY;
                }
            }
            const settingsAdj = attributeBonus + archetypeAdj;

            return {
                recruit: r,
                needScore: need.needScore,
                needInfo: need,
                talentPercentile,
                nilPercentile,
                interestScore,
                geoScore: geo.score,
                geoLabel: geo.label,
                settingsAdj,
                // Day One: talent and need dominate - this recruit has to be
                // both great and walking into a real opening. (No NIL term to
                // nudge here, so Team Direction shifts talent <-> need instead.)
                dayOneScore: (0.45 - nudge) * talentPercentile + (0.30 + nudge) * need.needScore + 0.15 * interestScore + 0.10 * geo.score + gemAdj + settingsAdj,
                // Program Movers: need, talent, NIL value, and interest balanced.
                programMoverScore: 0.30 * need.needScore + (0.25 - nudge) * talentPercentile + (0.20 + nudge) * nilPercentile + 0.15 * interestScore + 0.10 * geo.score + gemAdj + settingsAdj,
                // Foundational: NIL value and need dominate over raw
                // immediate talent - the affordable, long-term roster builders.
                foundationalScore: 0.25 * need.needScore + (0.20 - nudge) * talentPercentile + (0.30 + nudge) * nilPercentile + 0.15 * interestScore + 0.10 * geo.score + gemAdj + settingsAdj
            };
        });
    }

    // Greedily takes the top-scoring candidates but caps how many can share
    // the same raw position, so one gaping hole (e.g. a roster with zero
    // Fullbacks, which scores near-maximum need for every FB recruit) can't
    // flood the whole board - a program needs one or two targets at a
    // position, not five. Backfills past the cap only if the eligible pool
    // is too small/homogenous to reach the limit otherwise.
    function selectTopWithPositionCap(candidates, scoreKey, limit, maxPerPosition) {
        const sorted = candidates.slice().sort((a, b) => b[scoreKey] - a[scoreKey]);
        const selected = [];
        const positionCounts = {};

        sorted.forEach(c => {
            if (selected.length >= limit) return;
            const pos = c.recruit.position;
            const count = positionCounts[pos] || 0;
            if (count >= maxPerPosition) return;
            selected.push(c);
            positionCounts[pos] = count + 1;
        });

        if (selected.length < limit) {
            const selectedRanks = new Set(selected.map(c => c.recruit.rank));
            sorted.forEach(c => {
                if (selected.length >= limit || selectedRanks.has(c.recruit.rank)) return;
                selected.push(c);
                selectedRanks.add(c.recruit.rank);
            });
        }

        return selected;
    }

    function assignRecruitTiers() {
        const candidates = computeRecruitTargetCandidates();
        if (!candidates.length) return { dayOne: [], programMovers: [], foundational: [] };

        const tierSizes = TEAM_DIRECTION_TIER_SIZES[coordinatorSettings.teamDirection] || TEAM_DIRECTION_TIER_SIZES.maintain;
        const used = new Set();

        // Day One Starters must be blue-chip caliber (4-5 stars, or a top-20
        // national rank at their position) - talent and need drive the order.
        const dayOneEligible = candidates.filter(c => c.recruit.starsNum >= 4 || c.recruit.posRank <= 20);
        const dayOne = selectTopWithPositionCap(dayOneEligible, 'dayOneScore', tierSizes.dayOne, 1);
        dayOne.forEach(c => used.add(c.recruit.rank));

        const programMovers = selectTopWithPositionCap(
            candidates.filter(c => !used.has(c.recruit.rank)), 'programMoverScore', tierSizes.programMovers, 2
        );
        programMovers.forEach(c => used.add(c.recruit.rank));

        const foundational = selectTopWithPositionCap(
            candidates.filter(c => !used.has(c.recruit.rank)), 'foundationalScore', tierSizes.foundational, 3
        );

        return { dayOne, programMovers, foundational };
    }

    function needLabelFor(score) {
        if (score >= 60) return { label: 'High Need', cls: 'tag-need-high' };
        if (score >= 30) return { label: 'Moderate Need', cls: 'tag-need-med' };
        return { label: 'Low Need', cls: 'tag-need-low' };
    }
    function interestLabelFor(score) {
        if (score >= 60) return { label: 'Strongly Interested', cls: 'tag-interest-high' };
        if (score >= 30) return { label: 'Interested', cls: 'tag-interest-med' };
        if (score > 0) return { label: 'Mild Interest', cls: 'tag-interest-low' };
        return { label: 'Not on Radar', cls: 'tag-interest-none' };
    }
    function nilLabelFor(nilAdjustment) {
        if (nilAdjustment >= 1) return { label: 'NIL Bargain', cls: 'tag-nil-good' };
        if (nilAdjustment <= -1) return { label: 'Premium Price', cls: 'tag-nil-bad' };
        return { label: 'Fair NIL Value', cls: 'tag-nil-mid' };
    }

    function targetCard(candidate, rank) {
        const r = candidate.recruit;
        const need = needLabelFor(candidate.needScore);
        const interest = interestLabelFor(candidate.interestScore);
        const nil = nilLabelFor(r.nilAdjustment);

        return `
            <div class="target-card">
                <div class="target-rank">#${rank}</div>
                <div class="target-main">
                    <div class="target-name">${escapeHtml(r.name)} <span class="target-pos">${r.position}</span></div>
                    <div class="target-meta">${starsHtml(r.starsNum)} &middot; OVR ${r.overall} &middot; ${splitCamel(r.homeState || '')} &middot; Natl #${r.rank}</div>
                    <div class="target-tags">
                        <span class="target-tag ${need.cls}">${need.label}</span>
                        <span class="target-tag ${interest.cls}">${interest.label}</span>
                        <span class="target-tag ${nil.cls}">${nil.label}</span>
                        ${candidate.geoLabel ? `<span class="target-tag tag-geo">${candidate.geoLabel}</span>` : ''}
                        ${gemBadge(r.gem)}
                    </div>
                </div>
            </div>
        `;
    }

    const TIER_CLASS_BY_NUM = { 4: 'tier-championship', 3: 'tier-contending', 2: 'tier-competing', 1: 'tier-rebuilding' };
    const GRADE_CLASS_BY_LETTER = { A: 'grade-a', B: 'grade-b', C: 'grade-c', D: 'grade-d', F: 'grade-f' };

    // The single most important context on the app's flagship page, so it's
    // a deliberately bigger, more colorful "hero" - team identity (name,
    // mascot, real team colors pulled from the save) up top, then just the
    // 3 stats that actually matter for a recruiting board: what tier of
    // program this is, and the NIL budget situation. Everything else that
    // used to live here (Conference Prestige/Brand Exposure/Program
    // Traditions/Stadium Atmosphere grades, Facilities Level) was cut - real
    // program-building context, but not decision-relevant for "who do I
    // target this cycle," which is what this page is actually for.
    function renderTeamContextSummary() {
        if (!userTeamContext) { teamContextSummary.innerHTML = ''; return; }
        const t = userTeamContext;
        const anyPlayer = allRosterPlayers.find(p => p.teamName === t.name);
        const tierLabel = anyPlayer ? anyPlayer.prestigeTierLabel : `Prestige ${t.prestige}`;
        // Strip the "(7-10)"-style numeric range - useful context on National
        // Landscape where multiple tiers are compared side by side, just
        // noise here where the team's own tier is the only one shown.
        const tierLabelClean = tierLabel.replace(/\s*\([^)]*\)\s*$/, '');
        const tierClass = anyPlayer ? (TIER_CLASS_BY_NUM[anyPlayer.prestigeTier] || '') : '';

        const gradeLetter = (t.grades.budget || '').trim().charAt(0).toUpperCase();
        const gradeClass = GRADE_CLASS_BY_LETTER[gradeLetter] || '';

        const mascot = anyPlayer && anyPlayer.teamMascot;
        const fullTeamName = mascot ? `${t.name} ${mascot}` : t.name;
        const colorPrimary = (anyPlayer && anyPlayer.teamColorPrimary) || '#ff6b35';
        const colorSecondary = (anyPlayer && anyPlayer.teamColorSecondary) || colorPrimary;
        // Hex+alpha suffix trick (same one used for the Top Teams glow
        // effect) rather than rgba()/color-mix(), since these come through
        // as plain "#rrggbb" strings already.
        const bannerGradient = `linear-gradient(120deg, ${colorPrimary}66 0%, ${colorSecondary}33 55%, transparent 100%)`;

        teamContextSummary.innerHTML = `
            <div class="team-hero-banner" style="background-image: ${bannerGradient}; border-left-color: ${colorPrimary};">
                <div class="team-hero-eyebrow">Your Team</div>
                <div class="team-hero-name">🏈 ${escapeHtml(fullTeamName)}</div>
            </div>
            <div class="team-hero-stats">
                <div class="hero-stat-card ${tierClass}">
                    <div class="hero-stat-icon">🏆</div>
                    <div class="hero-stat-label">Program Tier</div>
                    <div class="hero-stat-value">${escapeHtml(tierLabelClean)}</div>
                </div>
                <div class="hero-stat-card hero-stat-budget">
                    <div class="hero-stat-icon">💰</div>
                    <div class="hero-stat-label">Remaining NIL Budget</div>
                    <div class="hero-stat-value">${t.budget.remaining} pts</div>
                </div>
                <div class="hero-stat-card ${gradeClass}">
                    <div class="hero-stat-icon">📊</div>
                    <div class="hero-stat-label">NIL Budget Grade</div>
                    <div class="hero-stat-value">${escapeHtml(t.grades.budget || 'N/A')}</div>
                </div>
            </div>
        `;
    }

    function renderRecruitTargets() {
        if (!userTeamContext) {
            targetsTitle.textContent = '🎯 Recruit Targets';
            teamContextSummary.innerHTML = '';
            targetsContainer.innerHTML = '<p class="empty-row">No human-controlled team detected in this save - Recruit Targets needs to know which program to build a board for.</p>';
            return;
        }
        if (!allRecruits.length || !allRosterPlayers.length) {
            targetsTitle.textContent = `🎯 Recruit Targets for ${userTeamContext.name}`;
            targetsContainer.innerHTML = '<p class="empty-row">Upload a save file to see recruit targets.</p>';
            return;
        }

        targetsTitle.textContent = `🎯 Recruit Targets for ${userTeamContext.name}`;
        renderTeamContextSummary();

        const { dayOne, programMovers, foundational } = assignRecruitTiers();
        const tierSizes = TEAM_DIRECTION_TIER_SIZES[coordinatorSettings.teamDirection] || TEAM_DIRECTION_TIER_SIZES.maintain;

        const sections = [
            {
                title: '🌱 Foundational Players', count: String(tierSizes.foundational),
                hint: 'Inexpensive from an NIL perspective, a good fit for a real position need, and projected to become starters within 2-3 seasons — the picks that keep the program going.',
                candidates: foundational
            },
            {
                title: '📈 Program Movers', count: String(tierSizes.programMovers),
                hint: 'Positional needs and clear upgrades over the players currently there, NIL budget-friendly, and projected to start within a year or two.',
                candidates: programMovers
            },
            {
                title: '⭐ Day One Starters', count: String(tierSizes.dayOne),
                hint: 'Immediate contributors who should start or play meaningful snaps right away, significantly improving their position group on the current roster.',
                candidates: dayOne
            }
        ];

        targetsContainer.innerHTML = sections.map(section => `
            <div class="targets-section">
                <h2>${section.title} <span class="targets-count">(Top ${section.count})</span></h2>
                <p class="leaderboard-hint">${section.hint}</p>
                <div class="targets-list">
                    ${section.candidates.length
                        ? section.candidates.map((c, i) => targetCard(c, i + 1)).join('')
                        : '<p class="empty-row">Not enough eligible recruits found for this category.</p>'}
                </div>
            </div>
        `).join('');
    }

    // Shared by the "Refresh Recruit Targets" button on both this tab and
    // the Coordinator Settings tab - saves whatever's currently selected
    // (even if the user hasn't hit "Save Settings" yet) so a reload right
    // after previewing doesn't lose it, then recomputes the board in place.
    function refreshRecruitTargetsFromSettings(statusEl) {
        saveSettingsToStorage(coordinatorSettings);
        renderRecruitTargets();
        if (statusEl) {
            statusEl.textContent = 'Recruit Targets refreshed.';
            statusEl.className = 'upload-status success';
        }
    }

    const refreshTargetsBtn = document.getElementById('refreshTargetsBtn');
    if (refreshTargetsBtn) refreshTargetsBtn.addEventListener('click', () => {
        refreshRecruitTargetsFromSettings(document.getElementById('refreshTargetsStatus'));
    });

    // ================= COORDINATOR SETTINGS TAB =================
    // Saved in this browser only (not tied to an account) for now - a
    // simple, correct starting point that doesn't require any backend
    // changes. Nothing here affects Recruit Targets yet; that wiring is a
    // separate follow-up.
    const SETTINGS_STORAGE_KEY = 'rc_coordinator_settings_v1';

    const TEAM_DIRECTIONS = [
        {
            key: 'rebuild', label: 'Rebuild',
            desc: 'Weighted heavier toward Foundational prospects. Build a good core for the program and find players who’ll be starting in 2-3 seasons, not right away.'
        },
        {
            key: 'maintain', label: 'Maintain',
            desc: 'Keep things going. A fair mix of Foundational and Program Mover players — balance long-term depth with realistic 1-2 year contributors.'
        },
        {
            key: 'competeNow', label: 'Compete Now',
            desc: 'All in on a championship. Prioritize players who are ready to start immediately and make the roster better today.'
        }
    ];

    // The real ratings available on rostered players/recruits throughout
    // this app - the same set used everywhere else (Class Landscape's Key
    // Rating columns, Recruit Targets' talent scoring, etc.).
    const ATTRIBUTE_OPTIONS = [
        ['speed', 'Speed'], ['strength', 'Strength'], ['awareness', 'Awareness'],
        ['agility', 'Agility'], ['acceleration', 'Acceleration'], ['jumping', 'Jumping'],
        ['throwPower', 'Throw Power'], ['throwAccuracy', 'Throw Accuracy'], ['catching', 'Catching'],
        ['tackle', 'Tackle'], ['manCoverage', 'Man Coverage'], ['runBlock', 'Run Block'], ['passBlock', 'Pass Block']
    ];

    // Sensible starting defaults per position - the same two ratings already
    // used as each position's "key stats" elsewhere in the app.
    const DEFAULT_POSITION_ATTRS = {
        QB: ['awareness', 'throwPower'], HB: ['speed', 'agility'], WR: ['speed', 'catching'], TE: ['catching', 'runBlock'],
        LT: ['strength', 'passBlock'], LG: ['strength', 'passBlock'], C: ['strength', 'passBlock'],
        RG: ['strength', 'passBlock'], RT: ['strength', 'passBlock'],
        LE: ['strength', 'tackle'], RE: ['strength', 'tackle'], DT: ['strength', 'tackle'],
        LOLB: ['speed', 'tackle'], MLB: ['speed', 'tackle'], ROLB: ['speed', 'tackle'],
        CB: ['speed', 'manCoverage'], FS: ['speed', 'manCoverage'], SS: ['speed', 'manCoverage']
    };

    // Real archetypes pulled directly from the save file's own per-player
    // PlayerType field (verified against actual rostered players) - not
    // invented values. Grouped positions that share the same underlying
    // archetype family (LT/RT, LG/RG, LE/RE, LOLB/ROLB, FS/SS) use identical
    // lists since that's exactly what the game itself does.
    const OT_ARCHETYPES = [['OT_Agile', 'Agile'], ['OT_WellRounded', 'Well Rounded'], ['OT_PassProtector', 'Pass Protector'], ['OT_Power', 'Power']];
    const G_ARCHETYPES = [['G_Power', 'Power'], ['G_WellRounded', 'Well Rounded'], ['G_Agile', 'Agile'], ['G_PassProtector', 'Pass Protector']];
    const DE_ARCHETYPES = [['DE_PurePower', 'Pure Power'], ['DE_SmallerSpeedRusher', 'Smaller Speed Rusher'], ['DE_PowerRusher', 'Power Rusher'], ['DE_RunStopper', 'Run Stopper']];
    const OLB_ARCHETYPES = [['OLB_PassCoverage', 'Pass Coverage'], ['OLB_RunStopper', 'Run Stopper'], ['OLB_PowerRusher', 'Power Rusher']];
    const S_ARCHETYPES = [['S_RunSupport', 'Run Support'], ['S_Hybrid', 'Hybrid'], ['S_Zone', 'Zone']];

    const ARCHETYPES_BY_POSITION = {
        QB: [['QB_PureScrambler', 'Pure Scrambler'], ['QB_Scrambler', 'Scrambler'], ['QB_FieldGeneral', 'Field General'], ['QB_Improviser', 'Improviser']],
        HB: [['HB_ReceivingBack', 'Receiving Back'], ['HB_ElusiveBack', 'Elusive Back'], ['HB_PowerBlocking', 'Power Blocking'], ['HB_ElusivePower', 'Elusive Power'], ['HB_PowerBack', 'Power Back'], ['HB_PowerReceiving', 'Power Receiving']],
        WR: [['WR_GadgetReceiver', 'Gadget Receiver'], ['WR_Physical', 'Physical'], ['WR_PhysicalBlocker', 'Physical Blocker'], ['WR_ShiftyRouteRunner', 'Shifty Route Runner'], ['WR_PhysicalRouteRunner', 'Physical Route Runner'], ['WR_Playmaker', 'Playmaker'], ['WR_DeepThreat', 'Deep Threat']],
        TE: [['TE_PhysicalRouteRunner', 'Physical Route Runner'], ['TE_VerticalThreat', 'Vertical Threat'], ['TE_Blocking', 'Blocking'], ['TE_PossessionBlocking', 'Possession Blocking'], ['TE_Possession', 'Possession']],
        LT: OT_ARCHETYPES, RT: OT_ARCHETYPES,
        LG: G_ARCHETYPES, RG: G_ARCHETYPES,
        C: [['C_Power', 'Power'], ['C_PassProtector', 'Pass Protector'], ['C_Agile', 'Agile'], ['C_WellRounded', 'Well Rounded']],
        LE: DE_ARCHETYPES, RE: DE_ARCHETYPES,
        DT: [['DT_NoseTackle', 'Nose Tackle'], ['DT_SpeedRusher', 'Speed Rusher'], ['DT_PurePower', 'Pure Power'], ['DT_PowerRusher', 'Power Rusher']],
        LOLB: OLB_ARCHETYPES, ROLB: OLB_ARCHETYPES,
        MLB: [['MLB_RunStopper', 'Run Stopper'], ['MLB_FieldGeneral', 'Field General'], ['MLB_PassCoverage', 'Pass Coverage']],
        CB: [['CB_MantoMan', 'Man to Man'], ['CB_HybridCorner', 'Hybrid Corner'], ['CB_Slot', 'Slot'], ['CB_Zone', 'Zone']],
        FS: S_ARCHETYPES, SS: S_ARCHETYPES
    };

    function getDefaultSettings() {
        const positions = {};
        ALL_RAW_POSITIONS.forEach(pos => {
            positions[pos] = {
                attr1: DEFAULT_POSITION_ATTRS[pos][0],
                attr2: DEFAULT_POSITION_ATTRS[pos][1],
                archetype1: '',
                archetype2: '',
                avoidArchetype: ''
            };
        });
        // On by default: neither hidden nor ignored - these are opt-in
        // preferences, not the default experience.
        return { teamDirection: 'maintain', hideGemBustStatus: false, ignoreGemBustStatus: false, positions };
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) return getDefaultSettings();
            const parsed = JSON.parse(raw);
            // Merge over defaults so a future position/field addition doesn't
            // break on an older saved settings blob.
            const defaults = getDefaultSettings();
            return {
                teamDirection: parsed.teamDirection || defaults.teamDirection,
                hideGemBustStatus: parsed.hideGemBustStatus ?? defaults.hideGemBustStatus,
                ignoreGemBustStatus: parsed.ignoreGemBustStatus ?? defaults.ignoreGemBustStatus,
                positions: Object.assign({}, defaults.positions, parsed.positions)
            };
        } catch (e) {
            return getDefaultSettings();
        }
    }

    function saveSettingsToStorage(settings) {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }

    let coordinatorSettings = loadSettings();

    function renderTeamDirectionCards() {
        const container = document.getElementById('teamDirectionCards');
        if (!container) return;
        container.innerHTML = TEAM_DIRECTIONS.map(d => `
            <div class="direction-card ${coordinatorSettings.teamDirection === d.key ? 'selected' : ''}" data-direction="${d.key}">
                <div class="direction-card-title"><span class="direction-card-check"></span> ${d.label}</div>
                <div class="direction-card-desc">${d.desc}</div>
            </div>
        `).join('');

        container.querySelectorAll('.direction-card').forEach(card => {
            card.addEventListener('click', () => {
                coordinatorSettings.teamDirection = card.dataset.direction;
                renderTeamDirectionCards();
            });
        });
    }

    function optionsHtml(options, selectedValue, placeholder) {
        const placeholderOpt = placeholder ? `<option value="">${placeholder}</option>` : '';
        return placeholderOpt + options.map(([value, label]) =>
            `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`
        ).join('');
    }

    function renderPositionPrioritiesTable() {
        const body = document.getElementById('positionPrioritiesBody');
        if (!body) return;

        body.innerHTML = ALL_RAW_POSITIONS.map(pos => {
            const settings = coordinatorSettings.positions[pos];
            const archetypes = ARCHETYPES_BY_POSITION[pos] || [];
            return `
                <tr>
                    <td class="name-cell">${POSITION_FULL_NAMES[pos] || pos}</td>
                    <td><select data-pos="${pos}" data-field="attr1">${optionsHtml(ATTRIBUTE_OPTIONS, settings.attr1)}</select></td>
                    <td><select data-pos="${pos}" data-field="attr2">${optionsHtml(ATTRIBUTE_OPTIONS, settings.attr2)}</select></td>
                    <td><select data-pos="${pos}" data-field="archetype1">${optionsHtml(archetypes, settings.archetype1, 'None')}</select></td>
                    <td><select data-pos="${pos}" data-field="archetype2">${optionsHtml(archetypes, settings.archetype2, 'None')}</select></td>
                    <td><select data-pos="${pos}" data-field="avoidArchetype">${optionsHtml(archetypes, settings.avoidArchetype, 'None')}</select></td>
                </tr>
            `;
        }).join('');

        body.querySelectorAll('select').forEach(select => {
            select.addEventListener('change', () => {
                coordinatorSettings.positions[select.dataset.pos][select.dataset.field] = select.value;
            });
        });
    }

    function renderGemBustToggles() {
        const hideToggle = document.getElementById('hideGemBustToggle');
        const ignoreToggle = document.getElementById('ignoreGemBustToggle');
        if (!hideToggle || !ignoreToggle) return;

        hideToggle.checked = coordinatorSettings.hideGemBustStatus;
        ignoreToggle.checked = coordinatorSettings.ignoreGemBustStatus;

        // Both toggles apply instantly to the Recruit Explorer sub-tab
        // (there's no "refresh" step there) - hiding/showing the badge and, for
        // Ignore, recomputing the Raw/NIL Adj. Rating columns right away.
        // The Recruit Targets board is intentionally NOT re-rendered here -
        // like every other Coordinator Settings change, it only takes effect
        // once "Refresh Recruit Targets" is clicked.
        hideToggle.onchange = () => {
            coordinatorSettings.hideGemBustStatus = hideToggle.checked;
            if (allRecruits.length) applyFiltersAndSort();
        };
        ignoreToggle.onchange = () => {
            coordinatorSettings.ignoreGemBustStatus = ignoreToggle.checked;
            recomputeEffectiveRatings();
            if (allRecruits.length) applyFiltersAndSort();
        };
    }

    function initSettingsTab() {
        renderTeamDirectionCards();
        renderGemBustToggles();
        renderPositionPrioritiesTable();

        const saveBtn = document.getElementById('saveSettingsBtn');
        const resetBtn = document.getElementById('resetSettingsBtn');
        const refreshBtn = document.getElementById('refreshTargetsFromSettingsBtn');
        const status = document.getElementById('settingsSaveStatus');

        if (saveBtn) saveBtn.addEventListener('click', () => {
            saveSettingsToStorage(coordinatorSettings);
            status.textContent = 'Saved.';
            status.className = 'upload-status success';
        });

        if (resetBtn) resetBtn.addEventListener('click', () => {
            coordinatorSettings = getDefaultSettings();
            renderTeamDirectionCards();
            renderGemBustToggles();
            renderPositionPrioritiesTable();
            recomputeEffectiveRatings();
            if (allRecruits.length) applyFiltersAndSort();
            status.textContent = '';
            status.className = 'upload-status';
        });

        if (refreshBtn) refreshBtn.addEventListener('click', () => refreshRecruitTargetsFromSettings(status));
    }

    initSettingsTab();

    // ---- Filter dropdown population ----
    function populateFilterOptions() {
        const positions = [...new Set(allRecruits.map(r => r.position))].sort();
        posFilter.innerHTML = '<option value="">All</option>' +
            positions.map(p => `<option value="${p}">${p}</option>`).join('');

        const states = [...new Set(allRecruits.map(r => r.homeState).filter(Boolean))].sort();
        stateFilter.innerHTML = '<option value="">All</option>' +
            states.map(s => `<option value="${s}">${splitCamel(s)}</option>`).join('');

        const schools = [...new Set(allRecruits.flatMap(r => r.interestedSchools || []))].sort();
        schoolFilter.innerHTML = '<option value="">Any School</option>' +
            schools.map(s => `<option value="${escapeAttr(s)}">${s}</option>`).join('');
    }

    function escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;');
    }

    function splitCamel(str) {
        return str.replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    // ---- Filtering + sorting ----
    [posFilter, starFilter, stateFilter, schoolFilter].forEach(el => el.addEventListener('change', () => {
        currentPage = 0;
        applyFiltersAndSort();
    }));
    searchBox.addEventListener('input', () => {
        currentPage = 0;
        applyFiltersAndSort();
    });
    rangeSelect.addEventListener('change', () => {
        currentPage = parseInt(rangeSelect.value, 10);
        renderTable();
    });
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 0) { currentPage--; syncRangeSelect(); renderTable(); }
    });
    nextPageBtn.addEventListener('click', () => {
        const maxPage = Math.max(0, Math.ceil(filteredSorted.length / PAGE_SIZE) - 1);
        if (currentPage < maxPage) { currentPage++; syncRangeSelect(); renderTable(); }
    });

    document.querySelectorAll('#recruitTable thead th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.key;
            if (sortKey === key) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortKey = key;
                sortDir = (key === 'name' || key === 'position' || key === 'homeState' || key === 'gem') ? 'asc' : 'desc';
            }
            currentPage = 0;
            applyFiltersAndSort();
        });
    });

    function applyFiltersAndSort() {
        const pos = posFilter.value;
        const star = starFilter.value;
        const state = stateFilter.value;
        const school = schoolFilter.value;
        const search = searchBox.value.trim().toLowerCase();

        filteredSorted = allRecruits.filter(r => {
            if (pos && r.position !== pos) return false;
            if (star && String(r.starsNum) !== star) return false;
            if (state && r.homeState !== state) return false;
            if (school && !(r.interestedSchools || []).includes(school)) return false;
            if (search && !r.name.toLowerCase().includes(search)) return false;
            return true;
        });

        // Sorting/display by Raw Rating or NIL Adj. Rating always reflects
        // the current Ignore Gem/Bust Status preference (see
        // recomputeEffectiveRatings) rather than the server's original value.
        const effectiveSortKey = sortKey === 'rawRating' ? 'rawRatingEffective'
            : sortKey === 'nilAdjustedRating' ? 'nilAdjustedRatingEffective'
            : sortKey;
        filteredSorted.sort((a, b) => {
            let av = a[effectiveSortKey], bv = b[effectiveSortKey];
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        buildRangeOptions();
        renderTable();
    }

    // ---- Range selector (Top 25 / 26-50 / etc.) ----
    function buildRangeOptions() {
        const total = filteredSorted.length;
        const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const options = [];
        for (let i = 0; i < pageCount; i++) {
            const start = i * PAGE_SIZE + 1;
            const end = Math.min(total, (i + 1) * PAGE_SIZE);
            const label = i === 0 ? `Top 25 (${start}-${end})` : `${start}-${end}`;
            options.push(`<option value="${i}">${label}</option>`);
        }
        rangeSelect.innerHTML = options.join('');
        if (currentPage >= pageCount) currentPage = pageCount - 1;
        rangeSelect.value = currentPage;
    }

    function syncRangeSelect() {
        rangeSelect.value = currentPage;
    }

    // ---- Rendering ----
    function renderTable() {
        const start = currentPage * PAGE_SIZE;
        const pageItems = filteredSorted.slice(start, start + PAGE_SIZE);

        tableBody.innerHTML = pageItems.map(r => `
            <tr>
                <td class="rank-cell">#${r.rank}</td>
                <td class="name-cell" title="${escapeHtml((r.interestedSchools || []).join(', ') || 'No school interest data')}">${escapeHtml(r.name)}</td>
                <td>${r.position}</td>
                <td>${splitCamel(r.homeState || '')}</td>
                <td>${starsHtml(r.starsNum)}</td>
                <td class="blur-target">${r.overall}</td>
                <td class="blur-target">${r.speed}</td>
                <td class="blur-target">${r.nil}</td>
                <td>${gemBadge(r.gem)}</td>
                <td class="rating-cell ${ratingClass(r.rawRatingEffective)}">${r.rawRatingEffective.toFixed(2)}</td>
                <td class="rating-cell ${ratingClass(r.nilAdjustedRatingEffective)}">${r.nilAdjustedRatingEffective.toFixed(2)}</td>
            </tr>
        `).join('');

        document.querySelectorAll('#recruitTable thead th').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            if (th.dataset.key === sortKey) th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        });

        resultCount.textContent = `${filteredSorted.length} recruit${filteredSorted.length === 1 ? '' : 's'} matched`;

        const pageCount = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
        pagerLabel.textContent = `Page ${currentPage + 1} of ${pageCount}`;
        prevPageBtn.disabled = currentPage === 0;
        nextPageBtn.disabled = currentPage >= pageCount - 1;
        rangeSelect.value = currentPage;
    }

    function starsHtml(n) {
        let out = '<span class="stars">';
        for (let i = 0; i < 5; i++) out += i < n ? '★' : '<span class="dim">★</span>';
        out += '</span>';
        return out;
    }

    function gemBadge(status) {
        // "Hide Gem/Bust Status" only hides this badge - the underlying
        // rating/scoring math is untouched by this toggle (see the separate
        // "Ignore Gem/Bust Status" toggle for that).
        if (coordinatorSettings.hideGemBustStatus) return '';
        const cls = status === 'GEM' ? 'badge-gem' : status === 'BUST' ? 'badge-bust' : 'badge-normal';
        return `<span class="badge ${cls}">${status}</span>`;
    }

    function ratingClass(val) {
        return val > 0 ? 'rating-positive' : val < 0 ? 'rating-negative' : '';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ================= ADMIN TAB =================
    // Only ever called after the server has confirmed the logged-in user is
    // the admin (see initAccountBar above) - but /api/admin/stats enforces
    // this independently regardless, so there's no real security reliance
    // on this function only being called at the "right" time.
    const refreshAdminStatsBtn = document.getElementById('refreshAdminStatsBtn');
    if (refreshAdminStatsBtn) refreshAdminStatsBtn.addEventListener('click', loadAdminStats);

    function formatDate(iso) {
        if (!iso) return '&mdash;';
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
            ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    async function loadAdminStats() {
        const summary = document.getElementById('adminStatsSummary');
        const growthBody = document.getElementById('adminGrowthBody');
        const signupsBody = document.getElementById('adminSignupsBody');
        const uploadsBody = document.getElementById('adminUploadsBody');
        if (!summary) return;

        try {
            const res = await fetch('/api/admin/stats');
            if (!res.ok) throw new Error('Failed to load admin stats (HTTP ' + res.status + ')');
            const stats = await res.json();

            summary.innerHTML = [
                ['Unique Visitors', stats.totalUniqueVisitors, 'accent'],
                ['Total Signups', stats.totalUsers, 'accent'],
                ['Successful Uploads', stats.totalUploads, ''],
                ['Failed Uploads', stats.totalFailedUploads, ''],
                ['Active Sessions', stats.activeSessions, '']
            ].map(([label, value, cls]) => `
                <div class="context-card">
                    <div class="context-label">${label}</div>
                    <div class="context-value ${cls}">${value}</div>
                </div>
            `).join('');

            growthBody.innerHTML = stats.windows.map(w => `
                <tr>
                    <td class="name-cell">Last ${w.days} day${w.days === 1 ? '' : 's'}</td>
                    <td>${w.uniqueVisitors}</td>
                    <td>${w.newUsers}</td>
                    <td>${w.uploads}</td>
                </tr>
            `).join('');

            signupsBody.innerHTML = stats.recentSignups.length
                ? stats.recentSignups.map(s => `
                    <tr>
                        <td>${escapeHtml(s.email)}</td>
                        <td>${formatDate(s.createdAt)}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="2" class="empty-row">No signups yet.</td></tr>';

            uploadsBody.innerHTML = stats.recentUploads.length
                ? stats.recentUploads.map(u => `
                    <tr>
                        <td>${escapeHtml(u.email || (u.visitorId ? `Anonymous (${u.visitorId.slice(0, 8)})` : '(unknown)'))}</td>
                        <td>${formatDate(u.createdAt)}</td>
                        <td>${u.success ? '<span class="badge badge-gem">OK</span>' : '<span class="badge badge-bust">FAILED</span>'}</td>
                        <td>${u.recruitCount ?? '&mdash;'}</td>
                        <td>${u.rosterCount ?? '&mdash;'}</td>
                        <td>${u.errorMessage ? escapeHtml(u.errorMessage) : '&mdash;'}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="6" class="empty-row">No upload attempts yet.</td></tr>';
        } catch (err) {
            console.error(err);
            summary.innerHTML = `<p class="empty-row">${escapeHtml(err.message)}</p>`;
        }
    }

    // ---- Admin: Feedback & Bugs sub-tab ----
    const refreshAdminFeedbackBtn = document.getElementById('refreshAdminFeedbackBtn');
    const feedbackStatusFilter = document.getElementById('feedbackStatusFilter');
    const feedbackTypeFilter = document.getElementById('feedbackTypeFilter');
    if (refreshAdminFeedbackBtn) refreshAdminFeedbackBtn.addEventListener('click', loadAdminFeedback);
    if (feedbackStatusFilter) feedbackStatusFilter.addEventListener('change', loadAdminFeedback);
    if (feedbackTypeFilter) feedbackTypeFilter.addEventListener('change', loadAdminFeedback);

    function fbTypeBadge(type) {
        return type === 'bug'
            ? '<span class="fb-type-badge fb-type-bug">🐛 Bug</span>'
            : '<span class="fb-type-badge fb-type-comment">💡 Comment</span>';
    }

    async function loadAdminFeedback() {
        const summary = document.getElementById('adminFeedbackSummary');
        const body = document.getElementById('adminFeedbackBody');
        if (!summary || !body) return;

        const params = new URLSearchParams();
        if (feedbackStatusFilter && feedbackStatusFilter.value) params.set('status', feedbackStatusFilter.value);
        if (feedbackTypeFilter && feedbackTypeFilter.value) params.set('type', feedbackTypeFilter.value);

        try {
            const res = await fetch('/api/admin/feedback?' + params.toString());
            if (!res.ok) throw new Error('Failed to load feedback (HTTP ' + res.status + ')');
            const data = await res.json();
            const counts = data.counts || {};

            summary.innerHTML = [
                ['Total Submissions', counts.total ?? 0, ''],
                ['New (Unreviewed)', counts.newCount ?? 0, 'accent'],
                ['Bug Reports', counts.bugCount ?? 0, ''],
                ['General Comments', counts.commentCount ?? 0, '']
            ].map(([label, value, cls]) => `
                <div class="context-card">
                    <div class="context-label">${label}</div>
                    <div class="context-value ${cls}">${value}</div>
                </div>
            `).join('');

            const items = data.items || [];
            body.innerHTML = items.length
                ? items.map(f => `
                    <tr>
                        <td>${fbTypeBadge(f.type)}</td>
                        <td>${f.pageContext ? escapeHtml(f.pageContext) : '&mdash;'}</td>
                        <td class="fb-message-cell">${escapeHtml(f.message)}</td>
                        <td>${escapeHtml(f.email || '(unknown)')}</td>
                        <td>${formatDate(f.createdAt)}</td>
                        <td>
                            <select data-feedback-id="${f.id}">
                                <option value="new" ${f.status === 'new' ? 'selected' : ''}>New</option>
                                <option value="reviewed" ${f.status === 'reviewed' ? 'selected' : ''}>Reviewed</option>
                                <option value="resolved" ${f.status === 'resolved' ? 'selected' : ''}>Resolved</option>
                            </select>
                        </td>
                    </tr>
                `).join('')
                : '<tr><td colspan="6" class="empty-row">No feedback matches these filters.</td></tr>';

            body.querySelectorAll('select[data-feedback-id]').forEach(select => {
                select.addEventListener('change', async () => {
                    const id = select.dataset.feedbackId;
                    const newStatus = select.value;
                    select.disabled = true;
                    try {
                        const res = await fetch(`/api/admin/feedback/${id}/status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: newStatus })
                        });
                        if (!res.ok) throw new Error('Failed to update status');
                        // Refresh the summary counts (New count especially) without
                        // losing the current filter selection or scroll position.
                        loadAdminFeedback();
                    } catch (err) {
                        console.error(err);
                        select.disabled = false;
                    }
                });
            });
        } catch (err) {
            console.error(err);
            summary.innerHTML = `<p class="empty-row">${escapeHtml(err.message)}</p>`;
        }
    }

    // ================= COACHING CAREER / RIVALRIES & RECORDS =================
    // Dynasty year numbers from the save are ordinals starting at 0 (Year 0,
    // Year 1, ...) - every place a year is shown to the user displays the
    // real calendar year instead: Year 0 = 2026, Year 1 = 2027, etc.
    const DYNASTY_BASE_YEAR = 2026;
    function toCalendarYear(dynastyYearOrdinal) {
        if (dynastyYearOrdinal == null) return '';
        return DYNASTY_BASE_YEAR + dynastyYearOrdinal;
    }

    function formatRecord(w, l, t) {
        return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
    }

    function formatGameDetail(g, opts) {
        opts = opts || {};
        if (!g) return '&mdash;';
        const scoreLine = `${g.myScore}-${g.oppScore}`;
        const cls = g.margin >= 0 ? 'good' : 'bad';
        const yearWk = `${toCalendarYear(g.year)}, Wk ${g.week}`;
        const opponentLine = opts.showOpponent && g.opponentName ? `<span class="record-detail">vs ${escapeHtml(g.opponentName)}</span>` : '';
        return `<span class="record-detail ${cls}">${scoreLine}</span><span class="record-detail">${yearWk}</span>${opponentLine}`;
    }

    function schoolBadge(r) {
        return `
            <span class="school-badge">
                <span class="badge-swatch" style="background:${r.colorPrimary || '#333'}; color:${r.colorSecondary || '#fff'};">${escapeHtml(r.abbr || r.name.slice(0, 3).toUpperCase())}</span>
                <span>
                    <span class="name-cell">${escapeHtml(r.name)}</span>
                    <span class="record-detail">${escapeHtml(r.mascot || '')}</span>
                </span>
            </span>
        `;
    }

    let allSchoolRecords = [];
    let allBowlByNameRecords = [];

    const schoolRecordBody = document.getElementById('schoolRecordBody');
    const schoolRecordSearch = document.getElementById('schoolRecordSearch');
    const bowlByNameBody = document.getElementById('bowlByNameBody');
    const bowlByNameSearch = document.getElementById('bowlByNameSearch');

    function renderSchoolRecords() {
        if (!schoolRecordBody) return;
        const q = schoolRecordSearch.value.trim().toLowerCase();
        let rows = allSchoolRecords.filter(r => !q || r.name.toLowerCase().includes(q));
        rows = rows.slice().sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name));

        if (!rows.length) {
            schoolRecordBody.innerHTML = '<tr><td colspan="7" class="empty-row">No schools match your search.</td></tr>';
            return;
        }

        schoolRecordBody.innerHTML = rows.map(r => `
            <tr>
                <td>${schoolBadge(r)}</td>
                <td class="record-cell">${formatRecord(r.wins, r.losses, r.ties)}</td>
                <td class="record-cell">${formatRecord(r.homeWins, r.homeLosses, r.homeTies)}</td>
                <td class="record-cell">${formatRecord(r.awayWins, r.awayLosses, r.awayTies)}</td>
                <td class="record-cell">${r.lastWinYear != null ? `${toCalendarYear(r.lastWinYear)} (Wk ${r.lastWinWeek})` : '&mdash;'}</td>
                <td class="record-cell">${formatGameDetail(r.biggestWin)}</td>
                <td class="record-cell">${formatGameDetail(r.worstLoss)}</td>
            </tr>
        `).join('');
    }

    function renderAggregateRecord(tbody, r, colspan) {
        if (!tbody) return;
        if (!r || r.gamesPlayed === 0) {
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-row">No games recorded yet.</td></tr>`;
            return;
        }
        tbody.innerHTML = `
            <tr>
                <td class="record-cell">${formatRecord(r.wins, r.losses, r.ties)}</td>
                <td class="record-cell">${formatRecord(r.homeWins, r.homeLosses, r.homeTies)}</td>
                <td class="record-cell">${formatRecord(r.awayWins, r.awayLosses, r.awayTies)}</td>
                <td class="record-cell">${r.lastWinYear != null ? `${toCalendarYear(r.lastWinYear)} (Wk ${r.lastWinWeek})` : '&mdash;'}</td>
                <td class="record-cell">${formatGameDetail(r.biggestWin, { showOpponent: true })}</td>
                <td class="record-cell">${formatGameDetail(r.worstLoss, { showOpponent: true })}</td>
            </tr>
        `;
    }

    function renderBowlByNameRecords() {
        if (!bowlByNameBody) return;
        const q = bowlByNameSearch.value.trim().toLowerCase();
        let rows = allBowlByNameRecords.filter(r => !q || r.name.toLowerCase().includes(q));
        rows = rows.slice().sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name));

        if (!rows.length) {
            bowlByNameBody.innerHTML = '<tr><td colspan="5" class="empty-row">No bowl games match your search.</td></tr>';
            return;
        }

        bowlByNameBody.innerHTML = rows.map(r => `
            <tr>
                <td class="name-cell">${escapeHtml(r.name)}</td>
                <td class="record-cell">${formatRecord(r.wins, r.losses, r.ties)}</td>
                <td class="record-cell">${r.lastWinYear != null ? `${toCalendarYear(r.lastWinYear)} (Wk ${r.lastWinWeek})` : '&mdash;'}</td>
                <td class="record-cell">${formatGameDetail(r.biggestWin, { showOpponent: true })}</td>
                <td class="record-cell">${formatGameDetail(r.worstLoss, { showOpponent: true })}</td>
            </tr>
        `).join('');
    }

    if (schoolRecordSearch) schoolRecordSearch.addEventListener('input', renderSchoolRecords);
    if (bowlByNameSearch) bowlByNameSearch.addEventListener('input', renderBowlByNameRecords);

    // Colors each of the 138 static markers with its own school's real
    // primary/secondary colors (same colorPrimary/colorSecondary fields
    // already used for schoolBadge() swatches and the Recruit Targets hero
    // banner) - matched via the data-team attribute baked into each
    // <circle> at build time against allSchoolRecords' `name` field, since
    // color data itself only exists per-dynasty (parsed from the save
    // file), not something that can be baked into the static markup the
    // way the marker positions themselves were. Falls back to the default
    // CSS color (a neutral blue) for any school with no resolvable color -
    // shouldn't normally happen once a dynasty's teams_meta is populated,
    // but harmless if it does.
    function applySchoolMarkerColors() {
        const recordsByName = new Map(allSchoolRecords.map(r => [r.name, r]));
        document.querySelectorAll('.us-school-marker-group').forEach(group => {
            const marker = group.querySelector('.us-school-marker');
            const record = recordsByName.get(group.dataset.team);
            if (marker && record && record.colorPrimary) {
                marker.style.fill = record.colorPrimary;
                marker.style.stroke = record.colorSecondary || 'var(--bg)';
            }
        });
    }

    // ---- US map: hover previews a state's schools, click pins it open
    // (so it still works on touch devices with no real hover) ----
    function setupUsMapInteractivity() {
        const usMap = document.getElementById('usMap');
        const popup = document.getElementById('usMapPopup');
        const popupTitle = document.getElementById('usMapPopupTitle');
        const popupBody = document.getElementById('usMapPopupBody');
        const popupClose = document.getElementById('usMapPopupClose');
        if (!usMap || usMap.dataset.wired) return; // wire the hover/click listeners only once
        usMap.dataset.wired = 'true';

        // One shared "pinned" target (either a state <path> or a school's
        // hit-circle) so a click-to-pin on either kind never gets silently
        // clobbered by a stray hover on the other kind.
        let pinnedEl = null;

        function clearHighlights() {
            document.querySelectorAll('.us-state').forEach(p => p.classList.remove('us-state-active'));
            document.querySelectorAll('.us-school-marker-group').forEach(g => g.classList.remove('us-school-marker-group-active'));
        }

        function showStatePopup(pathEl) {
            const stateName = pathEl.dataset.name;
            const schools = allSchoolRecords
                .filter(r => r.state === stateName)
                .slice()
                .sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name));

            popupTitle.textContent = stateName;
            popupBody.innerHTML = schools.length
                ? schools.map(r => `
                    <div class="us-map-popup-school">
                        <div>
                            <div class="us-map-popup-school-name">${escapeHtml(r.name)}</div>
                            <div class="us-map-popup-school-detail">${r.lastAwayWinYear != null
                                ? `Last won there: ${toCalendarYear(r.lastAwayWinYear)} (Wk ${r.lastAwayWinWeek})`
                                : 'Never won there'}</div>
                        </div>
                        <div class="us-map-popup-record">${formatRecord(r.wins, r.losses, r.ties)}</div>
                    </div>
                `).join('')
                : '<p class="empty-row">No tracked schools in this state.</p>';

            popup.classList.remove('hidden');
            clearHighlights();
            pathEl.classList.add('us-state-active');
        }

        // One specific school's own history - the marker equivalent of the
        // state popup above, matched against the same allSchoolRecords
        // already loaded for the table/state popups (no extra fetch).
        function showSchoolPopup(groupEl) {
            const teamName = groupEl.dataset.team;
            const r = allSchoolRecords.find(x => x.name === teamName);
            if (!r) return;

            popupTitle.textContent = r.name;
            const rows = [
                ['Overall', formatRecord(r.wins, r.losses, r.ties)],
                ['Home / Away', `${formatRecord(r.homeWins, r.homeLosses, r.homeTies)} / ${formatRecord(r.awayWins, r.awayLosses, r.awayTies)}`],
                ['Last Win', r.lastWinYear != null ? `${toCalendarYear(r.lastWinYear)} (Wk ${r.lastWinWeek})` : '&mdash;'],
                ['Last Won There', r.lastAwayWinYear != null ? `${toCalendarYear(r.lastAwayWinYear)} (Wk ${r.lastAwayWinWeek})` : 'Never']
            ];
            popupBody.innerHTML =
                (r.mascot ? `<div class="us-map-popup-school-detail" style="margin-bottom: 8px;">${escapeHtml(r.mascot)}</div>` : '') +
                rows.map(([label, value]) => `
                    <div class="us-map-popup-school">
                        <div class="us-map-popup-school-name">${label}</div>
                        <div class="us-map-popup-record">${value}</div>
                    </div>
                `).join('') +
                (r.biggestWin ? `<div class="us-map-popup-school"><div class="us-map-popup-school-name">Biggest Win</div><div class="us-map-popup-record">${formatGameDetail(r.biggestWin)}</div></div>` : '') +
                (r.worstLoss ? `<div class="us-map-popup-school"><div class="us-map-popup-school-name">Worst Loss</div><div class="us-map-popup-record">${formatGameDetail(r.worstLoss)}</div></div>` : '');

            popup.classList.remove('hidden');
            clearHighlights();
            groupEl.classList.add('us-school-marker-group-active');
        }

        function hidePopup() {
            popup.classList.add('hidden');
            clearHighlights();
            pinnedEl = null;
        }

        document.querySelectorAll('.us-state').forEach(pathEl => {
            pathEl.addEventListener('mouseenter', () => {
                if (pinnedEl) return; // a click-pinned popup takes priority over hover
                showStatePopup(pathEl);
            });
            pathEl.addEventListener('mouseleave', () => {
                if (pinnedEl) return;
                hidePopup();
            });
            pathEl.addEventListener('click', () => {
                if (pinnedEl === pathEl) { hidePopup(); return; }
                pinnedEl = pathEl;
                showStatePopup(pathEl);
            });
        });

        // Each school's larger invisible hit-circle sits directly on top of
        // its state at that exact point, so hovering it takes priority over
        // the state there (see .us-school-marker-hit in style.css) - hovering
        // anywhere else in the same state still falls through to the state's
        // own handlers above exactly as before.
        document.querySelectorAll('.us-school-marker-group').forEach(groupEl => {
            const hitEl = groupEl.querySelector('.us-school-marker-hit');
            if (!hitEl) return;
            hitEl.addEventListener('mouseenter', () => {
                if (pinnedEl) return;
                showSchoolPopup(groupEl);
            });
            hitEl.addEventListener('mouseleave', () => {
                if (pinnedEl) return;
                hidePopup();
            });
            hitEl.addEventListener('click', () => {
                if (pinnedEl === groupEl) { hidePopup(); return; }
                pinnedEl = groupEl;
                showSchoolPopup(groupEl);
            });
        });

        if (popupClose) popupClose.addEventListener('click', hidePopup);
    }

    // Fetches everything Rivalries & Records needs. 401 on the first call
    // means dynastyRecordsGate blocked an anonymous hosted visitor - shows
    // the login prompt instead of empty tables, since there's a real reason
    // (not just "no data yet") that nothing can load. Safe to call
    // repeatedly (lazy-loaded on first tab visit, then again after every
    // successful upload - see the top-tab click handler and uploadFile()).
    async function loadCoachingCareer() {
        const loginPrompt = document.getElementById('coachingCareerLoginPrompt');
        const content = document.getElementById('coachingCareerContent');
        if (!loginPrompt || !content) return;

        try {
            const schoolsRes = await fetch('/api/records/schools');
            if (schoolsRes.status === 401) {
                loginPrompt.classList.remove('hidden');
                content.classList.add('hidden');
                return;
            }
            if (!schoolsRes.ok) throw new Error('Failed to load records (HTTP ' + schoolsRes.status + ')');
            loginPrompt.classList.add('hidden');
            content.classList.remove('hidden');

            allSchoolRecords = await schoolsRes.json();
            renderSchoolRecords();
            setupUsMapInteractivity();
            applySchoolMarkerColors();

            const [bowlRes, playoffRes, byNameRes] = await Promise.all([
                fetch('/api/records/bowls'),
                fetch('/api/records/playoffs'),
                fetch('/api/records/bowls-by-name')
            ]);
            renderAggregateRecord(document.getElementById('bowlRecordBody'), await bowlRes.json(), 6);
            renderAggregateRecord(document.getElementById('playoffRecordBody'), await playoffRes.json(), 6);
            allBowlByNameRecords = await byNameRes.json();
            renderBowlByNameRecords();
        } catch (err) {
            console.error(err);
            if (schoolRecordBody) schoolRecordBody.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    // ---- Recruiting Classes (Coaching Career) ----
    // Same login gate/pattern as Rivalries & Records - a class history
    // accumulated across uploads needs a durable identity. Each year's row
    // expands in place to show the full signee list, same interaction as
    // the Top 5 Teams table on National Landscape. Shared by Best Players
    // below: starString/teamSwatch aren't specific to recruiting.
    const STAR_CHAR = '★';
    function starString(stars) {
        return stars ? STAR_CHAR.repeat(stars) : '&mdash;';
    }

    function teamSwatch(team) {
        if (!team) return '';
        const abbr = team.abbr || (team.name ? team.name.slice(0, 3).toUpperCase() : '');
        return `<span class="badge-swatch" style="background:${team.colorPrimary || '#333'}; color:${team.colorSecondary || '#fff'};">${escapeHtml(abbr)}</span>`;
    }

    // fallbackTeam covers the top-signees list, where every signee already
    // carries its own .team; falls back to the class row's team when
    // rendering one year's expanded signee list (every signee in a single
    // class year necessarily signed with the same school).
    function signeeDetailCards(signees, fallbackTeam) {
        if (!signees.length) {
            return '<div class="player-detail-empty">No signees recorded for this class.</div>';
        }
        return signees
            .slice()
            .sort((a, b) => (b.overall || 0) - (a.overall || 0) || (b.stars || 0) - (a.stars || 0))
            .map(s => {
                const team = s.team || fallbackTeam;
                return `
                    <div class="player-detail-card">
                        <div class="pd-header">
                            ${teamSwatch(team)}
                            <span class="pd-name">${escapeHtml(s.name)}</span>
                            <span class="pd-pos">${escapeHtml(s.position || '')}</span>
                        </div>
                        <div class="pd-meta">${starString(s.stars)} &middot; Overall ${s.overall != null ? s.overall : '&mdash;'}${s.homeState ? ` &middot; ${escapeHtml(s.homeState)}` : ''}${team ? ` &middot; ${escapeHtml(team.name)}` : ''}</div>
                    </div>
                `;
            }).join('');
    }

    function renderRecruitingClasses(classes) {
        const body = document.getElementById('recruitingClassesBody');
        if (!body) return;
        if (!classes.length) {
            body.innerHTML = '<tr><td colspan="5" class="empty-row">No recruiting classes recorded yet - upload again once your next class signs.</td></tr>';
            return;
        }
        body.innerHTML = classes.map(c => `
            <tr class="team-row clickable-row" data-year="${c.classYear}" data-colspan="5">
                <td>${toCalendarYear(c.classYear)}</td>
                <td>${c.team ? teamSwatch(c.team) + ' ' + escapeHtml(c.team.name) : '&mdash;'}</td>
                <td class="key-stat">${c.signeeCount}</td>
                <td class="key-stat">${c.avgStars != null ? c.avgStars.toFixed(2) : '&mdash;'}</td>
                <td class="key-stat">${c.blueChipCount}</td>
            </tr>
        `).join('');
    }

    function renderRecruitingCareerStats(summary) {
        const el = document.getElementById('recruitingCareerStats');
        if (el) {
            el.innerHTML = `
                <div class="hero-stat-card">
                    <div class="hero-stat-icon">📜</div>
                    <div class="hero-stat-label">Classes Tracked</div>
                    <div class="hero-stat-value">${summary.classYearsTracked}</div>
                </div>
                <div class="hero-stat-card">
                    <div class="hero-stat-icon">✍️</div>
                    <div class="hero-stat-label">Total Signees</div>
                    <div class="hero-stat-value">${summary.signeeCount}</div>
                </div>
                <div class="hero-stat-card">
                    <div class="hero-stat-icon">⭐</div>
                    <div class="hero-stat-label">Career Avg Stars</div>
                    <div class="hero-stat-value">${summary.avgStars != null ? summary.avgStars.toFixed(2) : '&mdash;'}</div>
                </div>
                <div class="hero-stat-card hero-stat-budget">
                    <div class="hero-stat-icon">💎</div>
                    <div class="hero-stat-label">4&ndash;5&#9733; Blue-Chips</div>
                    <div class="hero-stat-value">${summary.blueChipCount}</div>
                </div>
            `;
        }
        const topEl = document.getElementById('recruitingTopSignees');
        if (topEl) topEl.innerHTML = signeeDetailCards(summary.topSignees || []);
    }

    let allRecruitingClasses = [];

    function populateRecruitingSchoolSelect(schools, selected) {
        const sel = document.getElementById('recruitingClassesSchoolSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">Whole Career (All Schools)</option>' +
            schools.map(s => `<option value="${s.teamIndex}">${escapeHtml(s.name)}</option>`).join('');
        sel.value = selected != null ? String(selected) : '';
    }

    // teamIndex omitted = whole career across every school this coach has
    // been at; passed = scoped to just that one school.
    async function loadRecruitingClasses(teamIndex) {
        const loginPrompt = document.getElementById('recruitingClassesLoginPrompt');
        const content = document.getElementById('recruitingClassesContent');
        if (!loginPrompt || !content) return;

        try {
            const qs = teamIndex != null ? `?team=${teamIndex}` : '';
            const [classesRes, careerRes, schoolsRes] = await Promise.all([
                fetch('/api/records/recruiting-classes' + qs),
                fetch('/api/records/recruiting-career' + qs),
                fetch('/api/records/recruiting-schools')
            ]);
            if (classesRes.status === 401) {
                loginPrompt.classList.remove('hidden');
                content.classList.add('hidden');
                return;
            }
            if (!classesRes.ok) throw new Error('Failed to load recruiting classes (HTTP ' + classesRes.status + ')');
            loginPrompt.classList.add('hidden');
            content.classList.remove('hidden');

            if (schoolsRes.ok) populateRecruitingSchoolSelect(await schoolsRes.json(), teamIndex);
            allRecruitingClasses = await classesRes.json();
            renderRecruitingClasses(allRecruitingClasses);
            if (careerRes.ok) renderRecruitingCareerStats(await careerRes.json());
        } catch (err) {
            console.error(err);
            const body = document.getElementById('recruitingClassesBody');
            if (body) body.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    const recruitingClassesBody = document.getElementById('recruitingClassesBody');
    if (recruitingClassesBody) {
        recruitingClassesBody.addEventListener('click', e => {
            const row = e.target.closest('.team-row');
            if (!row) return;

            const next = row.nextElementSibling;
            if (next && next.classList.contains('detail-row')) {
                next.remove();
                row.classList.remove('expanded');
                return;
            }
            document.querySelectorAll('#recruitingClassesBody .detail-row').forEach(el => el.remove());
            document.querySelectorAll('#recruitingClassesBody .team-row').forEach(el => el.classList.remove('expanded'));

            const cls = allRecruitingClasses.find(c => String(c.classYear) === row.dataset.year);
            const detailHtml = `
                <tr class="detail-row">
                    <td colspan="${row.dataset.colspan}">
                        <div class="player-detail-panel">${signeeDetailCards(cls ? cls.signees : [], cls ? cls.team : null)}</div>
                    </td>
                </tr>
            `;
            row.insertAdjacentHTML('afterend', detailHtml);
            row.classList.add('expanded');
        });
    }

    const recruitingClassesSchoolSelect = document.getElementById('recruitingClassesSchoolSelect');
    if (recruitingClassesSchoolSelect) {
        recruitingClassesSchoolSelect.addEventListener('change', () => {
            const val = recruitingClassesSchoolSelect.value;
            loadRecruitingClasses(val === '' ? null : Number(val));
        });
    }

    // ---- Best Players (Coaching Career) ----
    // Same login gate/pattern as the rest of Coaching Career. Overall drives
    // the ranking; Key Stats is whichever of that position's real career
    // totals the save tracks (see KEY_STAT_FIELDS_BY_POSITION in
    // lib/parseNotablePlayers.js) - blank for positions with no comparable
    // individual counting stat (OL/K/P).
    const KEY_STAT_LABELS = {
        passYards: 'Pass Yds', passTDs: 'Pass TD', passInts: 'INT',
        rushYards: 'Rush Yds', rushTDs: 'Rush TD',
        receiveYards: 'Rec Yds', receiveTDs: 'Rec TD', receiveCatches: 'Rec',
        tackles: 'Tkl', sacks: 'Sacks', tacklesForLoss: 'TFL', ints: 'INT', passDeflections: 'PD'
    };

    function keyStatsLine(stats) {
        if (!stats || !Object.keys(stats).length) return '&mdash;';
        return Object.entries(stats)
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${v} ${KEY_STAT_LABELS[k] || k}`)
            .join(' &middot; ');
    }

    let notablePlayers = [];

    function populateNotablePlayersSchoolSelect(schools, selected) {
        const sel = document.getElementById('notablePlayersSchoolSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">Whole Career (All Schools)</option>' +
            schools.map(s => `<option value="${s.teamIndex}">${escapeHtml(s.name)}</option>`).join('');
        sel.value = selected != null ? String(selected) : '';
    }

    function populateNotablePlayersPositionSelect(players) {
        const sel = document.getElementById('notablePlayersPositionSelect');
        if (!sel) return;
        const current = sel.value;
        const positions = [...new Set(players.map(p => p.position))].sort();
        sel.innerHTML = '<option value="">All Positions</option>' + positions.map(p => `<option value="${p}">${p}</option>`).join('');
        if (positions.includes(current)) sel.value = current;
    }

    function renderNotablePlayers() {
        const body = document.getElementById('notablePlayersBody');
        if (!body) return;
        const posSel = document.getElementById('notablePlayersPositionSelect');
        const pos = posSel ? posSel.value : '';
        const filtered = pos ? notablePlayers.filter(p => p.position === pos) : notablePlayers;

        if (!filtered.length) {
            body.innerHTML = '<tr><td colspan="5" class="empty-row">No notable players recorded yet - upload again once your starters take the field.</td></tr>';
            return;
        }
        body.innerHTML = filtered.map((p, i) => `
            <tr>
                <td class="rank-cell">#${i + 1}</td>
                <td>
                    <span class="pd-name">${escapeHtml(p.name)}</span>
                    <span class="record-detail">${escapeHtml(p.position)}${p.schoolYear ? ' &middot; ' + escapeHtml(p.schoolYear) : ''}</span>
                </td>
                <td>${p.team ? teamSwatch(p.team) + ' ' + escapeHtml(p.team.name) : '&mdash;'}</td>
                <td class="key-stat">${p.overall}</td>
                <td>${keyStatsLine(p.stats)}</td>
            </tr>
        `).join('');
    }

    async function loadNotablePlayers(teamIndex) {
        const loginPrompt = document.getElementById('notablePlayersLoginPrompt');
        const content = document.getElementById('notablePlayersContent');
        if (!loginPrompt || !content) return;

        try {
            const qs = teamIndex != null ? `?team=${teamIndex}` : '';
            const [playersRes, schoolsRes] = await Promise.all([
                fetch('/api/records/notable-players' + qs),
                fetch('/api/records/notable-players-schools')
            ]);
            if (playersRes.status === 401) {
                loginPrompt.classList.remove('hidden');
                content.classList.add('hidden');
                return;
            }
            if (!playersRes.ok) throw new Error('Failed to load best players (HTTP ' + playersRes.status + ')');
            loginPrompt.classList.add('hidden');
            content.classList.remove('hidden');

            if (schoolsRes.ok) populateNotablePlayersSchoolSelect(await schoolsRes.json(), teamIndex);
            notablePlayers = await playersRes.json();
            populateNotablePlayersPositionSelect(notablePlayers);
            renderNotablePlayers();
        } catch (err) {
            console.error(err);
            const body = document.getElementById('notablePlayersBody');
            if (body) body.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    const notablePlayersSchoolSelect = document.getElementById('notablePlayersSchoolSelect');
    if (notablePlayersSchoolSelect) {
        notablePlayersSchoolSelect.addEventListener('change', () => {
            const val = notablePlayersSchoolSelect.value;
            loadNotablePlayers(val === '' ? null : Number(val));
        });
    }
    const notablePlayersPositionSelect = document.getElementById('notablePlayersPositionSelect');
    if (notablePlayersPositionSelect) {
        notablePlayersPositionSelect.addEventListener('change', () => renderNotablePlayers());
    }

    // ---- Top 25 Poll (National Landscape) ----
    // Same login gate/pattern as Coaching Career - a week-by-week history
    // accumulated across uploads needs a durable identity. top25Available is
    // the flat list of every (year, week) this user has a snapshot for,
    // refreshed alongside the snapshot itself so the Year/Week selectors
    // always reflect what's actually queryable.
    let top25Available = [];

    function top25WeekLabel(week, stage) {
        if (week === -1) return 'Final';
        return `Week ${week}` + (stage ? ` (${stage})` : '');
    }

    function populateTop25YearSelect(selectedYear) {
        const sel = document.getElementById('top25YearSelect');
        if (!sel) return;
        const years = [...new Set(top25Available.map(a => a.seasonYear))].sort((a, b) => b - a);
        sel.innerHTML = years.map(y => `<option value="${y}">${toCalendarYear(y)}</option>`).join('');
        if (selectedYear != null && years.includes(selectedYear)) sel.value = String(selectedYear);
    }

    // Weeks sorted latest-first so a fresh year selection defaults (via the
    // select's own first option) to its most recent tracked week.
    function populateTop25WeekSelect(year, selectedWeek) {
        const sel = document.getElementById('top25WeekSelect');
        if (!sel) return;
        const weeks = top25Available.filter(a => a.seasonYear === year).sort((a, b) => b.seasonWeek - a.seasonWeek);
        sel.innerHTML = weeks.map(w => `<option value="${w.seasonWeek}">${top25WeekLabel(w.seasonWeek, w.seasonStage)}</option>`).join('');
        if (selectedWeek != null && weeks.some(w => w.seasonWeek === selectedWeek)) sel.value = String(selectedWeek);
    }

    // Defaults to the blended "Coordinator 25" - falls back to Offense (see
    // renderTop25Table) for a historical snapshot with no retained poll data.
    let top25SortKey = 'compositeRank';
    let top25CurrentRows = [];

    function top25PollLabel(rank) {
        if (rank == null) return '&mdash;';
        if (rank <= 0) return 'NR';
        return '#' + rank;
    }

    function renderTop25Table(rows) {
        top25CurrentRows = rows || [];
        const body = document.getElementById('top25Body');
        if (!body) return;
        if (!top25CurrentRows.length) {
            body.innerHTML = '<tr><td colspan="10" class="empty-row">No Top 25 data for this week yet.</td></tr>';
            return;
        }

        // A historical season (predating this feature) has no poll data at
        // all - fall back to Offense so the table never silently renders in
        // an arbitrary/unsorted order.
        let key = top25SortKey;
        if (!top25CurrentRows.some(r => r[key] != null)) key = 'offenseRank';

        const sorted = top25CurrentRows
            .filter(r => r[key] != null)
            .sort((a, b) => a[key] - b[key])
            .slice(0, 25);

        body.innerHTML = sorted.map((r, i) => `
            <tr>
                <td class="rank-cell">#${i + 1}</td>
                <td>${schoolBadge(r)}</td>
                <td class="record-cell">${formatRecord(r.wins, r.losses, r.ties)}</td>
                <td class="record-cell">${r.confWins != null ? formatRecord(r.confWins, r.confLosses, r.confTies) : '&mdash;'}</td>
                <td class="key-stat${key === 'mediaRank' ? ' top25-sorted-col' : ''}">${top25PollLabel(r.mediaRank)}</td>
                <td class="key-stat${key === 'coachesRank' ? ' top25-sorted-col' : ''}">${top25PollLabel(r.coachesRank)}</td>
                <td class="key-stat${key === 'cfpRank' ? ' top25-sorted-col' : ''}">${top25PollLabel(r.cfpRank)}</td>
                <td class="key-stat${key === 'compositeRank' ? ' top25-sorted-col' : ''}">${top25PollLabel(r.compositeRank)}</td>
                <td class="key-stat${key === 'offenseRank' ? ' top25-sorted-col' : ''}">#${r.offenseRank}${r.isProjected ? ' <span class="record-detail">(proj.)</span>' : ''}</td>
                <td class="key-stat${key === 'defenseRank' ? ' top25-sorted-col' : ''}">#${r.defenseRank}${r.isProjected ? ' <span class="record-detail">(proj.)</span>' : ''}</td>
            </tr>
        `).join('');

        document.querySelectorAll('#top25Table th.sortable-col').forEach(th => {
            th.classList.toggle('active-sort', th.dataset.sortKey === key);
        });
    }

    document.querySelectorAll('#top25Table th.sortable-col').forEach(th => {
        th.addEventListener('click', () => {
            top25SortKey = th.dataset.sortKey;
            renderTop25Table(top25CurrentRows);
        });
    });

    // Omit year/week for the most recent in-progress-season snapshot
    // ("current"). Safe to call repeatedly (lazy-loaded on first National
    // Landscape visit, then again after every successful upload/refresh).
    async function loadTop25(year, week) {
        const loginPrompt = document.getElementById('top25LoginPrompt');
        const content = document.getElementById('top25Content');
        if (!loginPrompt || !content) return;

        try {
            const qs = (year != null && week != null) ? `?year=${year}&week=${week}` : '';
            const [snapshotRes, availableRes] = await Promise.all([
                fetch('/api/top25' + qs),
                fetch('/api/top25/available')
            ]);
            if (snapshotRes.status === 401) {
                loginPrompt.classList.remove('hidden');
                content.classList.add('hidden');
                return;
            }
            if (!snapshotRes.ok) throw new Error('Failed to load Top 25 (HTTP ' + snapshotRes.status + ')');
            loginPrompt.classList.add('hidden');
            content.classList.remove('hidden');

            if (availableRes.ok) top25Available = await availableRes.json();
            const snapshot = await snapshotRes.json();

            if (snapshot.seasonYear == null) {
                renderTop25Table([]);
                return;
            }
            populateTop25YearSelect(snapshot.seasonYear);
            populateTop25WeekSelect(snapshot.seasonYear, snapshot.seasonWeek);
            renderTop25Table(snapshot.rows);
        } catch (err) {
            console.error(err);
            const body = document.getElementById('top25Body');
            if (body) body.innerHTML = `<tr><td colspan="10" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    const top25YearSelect = document.getElementById('top25YearSelect');
    const top25WeekSelect = document.getElementById('top25WeekSelect');
    const top25CurrentBtn = document.getElementById('top25CurrentBtn');

    if (top25YearSelect) {
        top25YearSelect.addEventListener('change', () => {
            const year = Number(top25YearSelect.value);
            populateTop25WeekSelect(year, null);
            if (top25WeekSelect && top25WeekSelect.value !== '') {
                loadTop25(year, Number(top25WeekSelect.value));
            }
        });
    }
    if (top25WeekSelect) {
        top25WeekSelect.addEventListener('change', () => {
            if (top25YearSelect && top25WeekSelect.value !== '') {
                loadTop25(Number(top25YearSelect.value), Number(top25WeekSelect.value));
            }
        });
    }
    if (top25CurrentBtn) {
        top25CurrentBtn.addEventListener('click', () => loadTop25());
    }

    // ---- Conference Standings (National Landscape) ----
    // Reuses the exact same snapshot/year/week list as Top 25 (GET
    // /api/top25/available covers both - see server.js) - the only new
    // moving part here is the conference dropdown. Offense/Defense are
    // recomputed server-side relative to just the selected conference, so
    // #1 offense here means best in that conference, not nationally.
    let confStandingsAvailable = [];
    let confStandingsSortKey = 'confRank';
    let confStandingsCurrentRows = [];

    function populateConfStandingsYearSelect(selectedYear) {
        const sel = document.getElementById('confStandingsYearSelect');
        if (!sel) return;
        const years = [...new Set(confStandingsAvailable.map(a => a.seasonYear))].sort((a, b) => b - a);
        sel.innerHTML = years.map(y => `<option value="${y}">${toCalendarYear(y)}</option>`).join('');
        if (selectedYear != null && years.includes(selectedYear)) sel.value = String(selectedYear);
    }

    function populateConfStandingsWeekSelect(year, selectedWeek) {
        const sel = document.getElementById('confStandingsWeekSelect');
        if (!sel) return;
        const weeks = confStandingsAvailable.filter(a => a.seasonYear === year).sort((a, b) => b.seasonWeek - a.seasonWeek);
        sel.innerHTML = weeks.map(w => `<option value="${w.seasonWeek}">${top25WeekLabel(w.seasonWeek, w.seasonStage)}</option>`).join('');
        if (selectedWeek != null && weeks.some(w => w.seasonWeek === selectedWeek)) sel.value = String(selectedWeek);
    }

    function populateConfStandingsConferenceSelect(conferences, selected) {
        const sel = document.getElementById('confStandingsConferenceSelect');
        if (!sel) return;
        sel.innerHTML = (conferences || []).map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
        if (selected && (conferences || []).includes(selected)) sel.value = selected;
    }

    function renderConfStandingsTable(rows) {
        confStandingsCurrentRows = rows || [];
        const body = document.getElementById('confStandingsBody');
        if (!body) return;
        if (!confStandingsCurrentRows.length) {
            body.innerHTML = '<tr><td colspan="7" class="empty-row">No conference standings for this week yet.</td></tr>';
            return;
        }

        // A historical season (predating this feature) has no retained
        // conference-record history - confRank is meaningless there, so
        // fall back to Offense same as Top 25 does for its own poll columns.
        let key = confStandingsSortKey;
        if (!confStandingsCurrentRows.some(r => r[key] != null)) key = 'offenseRank';

        const sorted = [...confStandingsCurrentRows]
            .filter(r => r[key] != null)
            .sort((a, b) => a[key] - b[key]);

        body.innerHTML = sorted.map(r => `
            <tr>
                <td class="rank-cell">${top25PollLabel(r.compositeRank != null && r.compositeRank <= 25 ? r.compositeRank : null)}</td>
                <td class="rank-cell">#${r.confRank}</td>
                <td>${schoolBadge(r)}</td>
                <td class="record-cell">${formatRecord(r.wins, r.losses, r.ties)}</td>
                <td class="record-cell">${r.confWins != null ? formatRecord(r.confWins, r.confLosses, r.confTies) : '&mdash;'}</td>
                <td class="key-stat${key === 'offenseRank' ? ' top25-sorted-col' : ''}">#${r.offenseRank}${r.isProjected ? ' <span class="record-detail">(proj.)</span>' : ''}</td>
                <td class="key-stat${key === 'defenseRank' ? ' top25-sorted-col' : ''}">#${r.defenseRank}${r.isProjected ? ' <span class="record-detail">(proj.)</span>' : ''}</td>
            </tr>
        `).join('');

        document.querySelectorAll('#confStandingsTable th.sortable-col').forEach(th => {
            th.classList.toggle('active-sort', th.dataset.sortKey === key);
        });
    }

    document.querySelectorAll('#confStandingsTable th.sortable-col').forEach(th => {
        th.addEventListener('click', () => {
            confStandingsSortKey = th.dataset.sortKey;
            renderConfStandingsTable(confStandingsCurrentRows);
        });
    });

    // Omit year/week for the current in-progress-season snapshot; omit
    // conference to let the server pick a default (alphabetically first) -
    // the response's own `conference` field is what actually gets selected.
    async function loadConfStandings(year, week, conference) {
        const loginPrompt = document.getElementById('confStandingsLoginPrompt');
        const content = document.getElementById('confStandingsContent');
        if (!loginPrompt || !content) return;

        try {
            const params = new URLSearchParams();
            if (year != null && week != null) { params.set('year', year); params.set('week', week); }
            if (conference) params.set('conference', conference);
            const qs = params.toString() ? '?' + params.toString() : '';

            const [standingsRes, availableRes] = await Promise.all([
                fetch('/api/conference-standings' + qs),
                fetch('/api/top25/available')
            ]);
            if (standingsRes.status === 401) {
                loginPrompt.classList.remove('hidden');
                content.classList.add('hidden');
                return;
            }
            if (!standingsRes.ok) throw new Error('Failed to load conference standings (HTTP ' + standingsRes.status + ')');
            loginPrompt.classList.add('hidden');
            content.classList.remove('hidden');

            if (availableRes.ok) confStandingsAvailable = await availableRes.json();
            const data = await standingsRes.json();

            if (data.seasonYear == null) {
                renderConfStandingsTable([]);
                return;
            }
            populateConfStandingsYearSelect(data.seasonYear);
            populateConfStandingsWeekSelect(data.seasonYear, data.seasonWeek);
            populateConfStandingsConferenceSelect(data.conferences, data.conference);
            renderConfStandingsTable(data.rows);
        } catch (err) {
            console.error(err);
            const body = document.getElementById('confStandingsBody');
            if (body) body.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    const confStandingsYearSelect = document.getElementById('confStandingsYearSelect');
    const confStandingsWeekSelect = document.getElementById('confStandingsWeekSelect');
    const confStandingsConferenceSelect = document.getElementById('confStandingsConferenceSelect');
    const confStandingsCurrentBtn = document.getElementById('confStandingsCurrentBtn');
    const confStandingsMyConferenceBtn = document.getElementById('confStandingsMyConferenceBtn');

    if (confStandingsYearSelect) {
        confStandingsYearSelect.addEventListener('change', () => {
            const year = Number(confStandingsYearSelect.value);
            populateConfStandingsWeekSelect(year, null);
            const conf = confStandingsConferenceSelect ? confStandingsConferenceSelect.value : null;
            if (confStandingsWeekSelect && confStandingsWeekSelect.value !== '') {
                loadConfStandings(year, Number(confStandingsWeekSelect.value), conf);
            }
        });
    }
    if (confStandingsWeekSelect) {
        confStandingsWeekSelect.addEventListener('change', () => {
            const conf = confStandingsConferenceSelect ? confStandingsConferenceSelect.value : null;
            if (confStandingsYearSelect && confStandingsWeekSelect.value !== '') {
                loadConfStandings(Number(confStandingsYearSelect.value), Number(confStandingsWeekSelect.value), conf);
            }
        });
    }
    if (confStandingsConferenceSelect) {
        confStandingsConferenceSelect.addEventListener('change', () => {
            const year = confStandingsYearSelect && confStandingsYearSelect.value !== '' ? Number(confStandingsYearSelect.value) : null;
            const week = confStandingsWeekSelect && confStandingsWeekSelect.value !== '' ? Number(confStandingsWeekSelect.value) : null;
            loadConfStandings(year, week, confStandingsConferenceSelect.value);
        });
    }
    if (confStandingsCurrentBtn) {
        confStandingsCurrentBtn.addEventListener('click', () => loadConfStandings());
    }
    if (confStandingsMyConferenceBtn) {
        // top25CurrentRows (every real team, already loaded by loadTop25) is
        // the cheapest way to find the user's own team's conference, without
        // a dedicated backend lookup - conference membership is stable
        // across a snapshot's week anyway.
        confStandingsMyConferenceBtn.addEventListener('click', () => {
            if (!userTeamContext) return;
            const match = top25CurrentRows.find(r => r.name === userTeamContext.name);
            loadConfStandings(null, null, match ? match.conference : null);
        });
    }

    // ---- Awards (National Landscape) ----
    // Three independent views sharing one login-gate wrapper (awardsContent/
    // awardsLoginPrompt) - Heisman is the only award with a real in-season
    // leaderboard, so it gets its own year/week search like Top 25; the
    // other 23 awards only ever have a final winner, browsable by year;
    // school totals is a career-wide aggregate with no time dimension.
    let heismanAvailable = [];

    function heismanWeekLabel(week, stage) {
        return `Week ${week}` + (stage ? ` (${stage})` : '');
    }

    function populateHeismanYearSelect(selectedYear) {
        const sel = document.getElementById('heismanYearSelect');
        if (!sel) return;
        const years = [...new Set(heismanAvailable.map(a => a.seasonYear))].sort((a, b) => b - a);
        sel.innerHTML = years.map(y => `<option value="${y}">${toCalendarYear(y)}</option>`).join('');
        if (selectedYear != null && years.includes(selectedYear)) sel.value = String(selectedYear);
    }

    function populateHeismanWeekSelect(year, selectedWeek) {
        const sel = document.getElementById('heismanWeekSelect');
        if (!sel) return;
        const weeks = heismanAvailable.filter(a => a.seasonYear === year).sort((a, b) => b.seasonWeek - a.seasonWeek);
        sel.innerHTML = weeks.map(w => `<option value="${w.seasonWeek}">${heismanWeekLabel(w.seasonWeek, w.seasonStage)}</option>`).join('');
        if (selectedWeek != null && weeks.some(w => w.seasonWeek === selectedWeek)) sel.value = String(selectedWeek);
    }

    function renderHeismanTable(candidates) {
        const body = document.getElementById('heismanBody');
        if (!body) return;
        if (!candidates.length) {
            body.innerHTML = '<tr><td colspan="3" class="empty-row">No Heisman race data for this week yet.</td></tr>';
            return;
        }
        body.innerHTML = candidates.map(c => `
            <tr>
                <td class="rank-cell">#${c.rank}</td>
                <td><span class="pd-name">${escapeHtml(c.name)}</span> <span class="record-detail">${escapeHtml(c.position || '')}</span></td>
                <td>${c.team ? teamSwatch(c.team) + ' ' + escapeHtml(c.team.name) : '&mdash;'}</td>
            </tr>
        `).join('');
    }

    // Login-gate check lives here since this is the first fetch made on
    // every load of the Awards sub-tab - loadAwardsByYear/loadAwardsSchools
    // are called right alongside it (see loadAwards below) and simply won't
    // be visible if this hides awardsContent.
    async function loadHeismanRace(year, week) {
        const loginPrompt = document.getElementById('awardsLoginPrompt');
        const content = document.getElementById('awardsContent');
        if (!loginPrompt || !content) return;

        try {
            const qs = (year != null && week != null) ? `?year=${year}&week=${week}` : '';
            const [raceRes, availableRes] = await Promise.all([
                fetch('/api/awards/heisman' + qs),
                fetch('/api/awards/heisman/available')
            ]);
            if (raceRes.status === 401) {
                loginPrompt.classList.remove('hidden');
                content.classList.add('hidden');
                return;
            }
            if (!raceRes.ok) throw new Error('Failed to load Heisman race (HTTP ' + raceRes.status + ')');
            loginPrompt.classList.add('hidden');
            content.classList.remove('hidden');

            if (availableRes.ok) heismanAvailable = await availableRes.json();
            const snapshot = await raceRes.json();
            if (snapshot.seasonYear == null) { renderHeismanTable([]); return; }
            populateHeismanYearSelect(snapshot.seasonYear);
            populateHeismanWeekSelect(snapshot.seasonYear, snapshot.seasonWeek);
            renderHeismanTable(snapshot.candidates);
        } catch (err) {
            console.error(err);
            const body = document.getElementById('heismanBody');
            if (body) body.innerHTML = `<tr><td colspan="3" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    const heismanYearSelect = document.getElementById('heismanYearSelect');
    const heismanWeekSelect = document.getElementById('heismanWeekSelect');
    const heismanCurrentBtn = document.getElementById('heismanCurrentBtn');
    if (heismanYearSelect) {
        heismanYearSelect.addEventListener('change', () => {
            const year = Number(heismanYearSelect.value);
            populateHeismanWeekSelect(year, null);
            if (heismanWeekSelect && heismanWeekSelect.value !== '') {
                loadHeismanRace(year, Number(heismanWeekSelect.value));
            }
        });
    }
    if (heismanWeekSelect) {
        heismanWeekSelect.addEventListener('change', () => {
            if (heismanYearSelect && heismanWeekSelect.value !== '') {
                loadHeismanRace(Number(heismanYearSelect.value), Number(heismanWeekSelect.value));
            }
        });
    }
    if (heismanCurrentBtn) {
        heismanCurrentBtn.addEventListener('click', () => loadHeismanRace());
    }

    // ---- Awards by Year ----
    let awardsAvailableYears = [];

    function populateAwardsYearSelect(selectedYear) {
        const sel = document.getElementById('awardsYearSelect');
        if (!sel) return;
        sel.innerHTML = awardsAvailableYears.map(y => `<option value="${y}">${toCalendarYear(y)}</option>`).join('');
        if (selectedYear != null && awardsAvailableYears.includes(selectedYear)) sel.value = String(selectedYear);
    }

    function renderAwardsByYear(rows) {
        const body = document.getElementById('awardsByYearBody');
        if (!body) return;
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="4" class="empty-row">No award data for this year yet.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(r => `
            <tr>
                <td>${escapeHtml(r.awardLabel)}</td>
                <td>${r.name ? escapeHtml(r.name) : '&mdash;'}</td>
                <td>${r.position ? escapeHtml(r.position) : '&mdash;'}</td>
                <td>${r.team ? teamSwatch(r.team) + ' ' + escapeHtml(r.team.name) : '&mdash;'}</td>
            </tr>
        `).join('');
    }

    async function loadAwardsByYear(year) {
        try {
            const yearsRes = await fetch('/api/awards/available-years');
            if (yearsRes.ok) awardsAvailableYears = await yearsRes.json();
            const targetYear = year != null ? year : (awardsAvailableYears.length ? awardsAvailableYears[0] : null);
            populateAwardsYearSelect(targetYear);

            if (targetYear == null) { renderAwardsByYear([]); return; }
            const rowsRes = await fetch('/api/awards/history?year=' + targetYear);
            renderAwardsByYear(rowsRes.ok ? await rowsRes.json() : []);
        } catch (err) {
            console.error(err);
            const body = document.getElementById('awardsByYearBody');
            if (body) body.innerHTML = `<tr><td colspan="4" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    const awardsYearSelect = document.getElementById('awardsYearSelect');
    if (awardsYearSelect) {
        awardsYearSelect.addEventListener('change', () => loadAwardsByYear(Number(awardsYearSelect.value)));
    }

    // ---- School Award Totals ----
    function schoolAwardBreakdownCards(breakdown) {
        if (!breakdown.length) return '<div class="player-detail-empty">No awards recorded.</div>';
        return breakdown.map(b => `
            <div class="player-detail-card">
                <div class="pd-header"><span class="pd-name">${escapeHtml(b.awardLabel)}</span></div>
                <div class="pd-meta">${b.count}&times; won</div>
            </div>
        `).join('');
    }

    let allAwardsSchoolsData = [];

    function renderAwardsSchools(schools) {
        const body = document.getElementById('awardsSchoolsBody');
        if (!body) return;
        if (!schools.length) {
            body.innerHTML = '<tr><td colspan="3" class="empty-row">No school award data yet.</td></tr>';
            return;
        }
        body.innerHTML = schools.map((s, i) => `
            <tr class="team-row clickable-row" data-idx="${i}" data-colspan="3">
                <td class="rank-cell">#${i + 1}</td>
                <td>${s.team ? teamSwatch(s.team) + ' ' + escapeHtml(s.team.name) : '&mdash;'}</td>
                <td class="key-stat">${s.totalWins}</td>
            </tr>
        `).join('');
    }

    async function loadAwardsSchools() {
        try {
            const res = await fetch('/api/awards/schools');
            allAwardsSchoolsData = res.ok ? await res.json() : [];
            renderAwardsSchools(allAwardsSchoolsData);
        } catch (err) {
            console.error(err);
            const body = document.getElementById('awardsSchoolsBody');
            if (body) body.innerHTML = `<tr><td colspan="3" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
        }
    }

    const awardsSchoolsBody = document.getElementById('awardsSchoolsBody');
    if (awardsSchoolsBody) {
        awardsSchoolsBody.addEventListener('click', e => {
            const row = e.target.closest('.team-row');
            if (!row) return;

            const next = row.nextElementSibling;
            if (next && next.classList.contains('detail-row')) {
                next.remove();
                row.classList.remove('expanded');
                return;
            }
            document.querySelectorAll('#awardsSchoolsBody .detail-row').forEach(el => el.remove());
            document.querySelectorAll('#awardsSchoolsBody .team-row').forEach(el => el.classList.remove('expanded'));

            const school = allAwardsSchoolsData[Number(row.dataset.idx)];
            const detailHtml = `
                <tr class="detail-row">
                    <td colspan="${row.dataset.colspan}">
                        <div class="player-detail-panel">${schoolAwardBreakdownCards(school ? school.breakdown : [])}</div>
                    </td>
                </tr>
            `;
            row.insertAdjacentHTML('afterend', detailHtml);
            row.classList.add('expanded');
        });
    }

    // Combined loader for the whole Awards sub-tab - called from the same
    // trigger points as loadTop25/loadConfStandings (upload/refresh success,
    // first National Landscape tab click).
    async function loadAwards() {
        await loadHeismanRace();
        await loadAwardsByYear();
        await loadAwardsSchools();
    }
})();
