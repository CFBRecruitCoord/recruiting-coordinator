(function () {
    // ---- Account bar: only shows anything in hosted (MULTI_TENANT_MODE)
    // deployments where /api/auth/me actually returns a logged-in user. In
    // personal-use mode this fetch just resolves to { user: null } and the
    // bar stays hidden, so it's a no-op there. ----
    (async function initAccountBar() {
        const bar = document.getElementById('accountBar');
        const emailEl = document.getElementById('accountEmail');
        const logoutBtn = document.getElementById('logoutBtn');
        if (!bar) return;
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            if (data.user) {
                emailEl.textContent = data.user.email;
                bar.classList.remove('hidden');
            }
        } catch (e) { /* not logged in / not hosted mode - leave hidden */ }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login.html';
            });
        }
    })();

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
                const detail = (data && data.error) || rawText.slice(0, 200) || `HTTP ${res.status}`;
                throw new Error(`Upload failed (HTTP ${res.status}): ${detail}`);
            }
            if (!data) throw new Error('Upload failed: server returned an unexpected (non-JSON) response.');

            allRecruits = data.recruits;
            allRosterPlayers = data.roster || [];
            userTeamContext = data.userTeam || null;
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

            // First successful upload ever (no refresh path configured yet):
            // offer to remember this file's location so future updates are a
            // single click instead of a re-upload.
            if (!currentSavePath && !pathPromptDismissed) {
                pathSetupInput.value = file.path || ''; // browsers usually don't expose this; harmless if empty
                pathSetupPrompt.classList.remove('hidden');
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
        });
    });

    // ================= CLASS LANDSCAPE TAB =================
    avgStarFilter.addEventListener('change', computeAndRenderAverages);

    function computeAndRenderAverages() {
        if (!allRecruits.length) {
            averagesBody.innerHTML = '<tr><td colspan="10" class="empty-row">Load recruits in the Recruit Explorer tab to see the class landscape.</td></tr>';
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
            matrixBody.innerHTML = '<tr><td colspan="5" class="empty-row">Load a save file in the Recruit Explorer tab to see the national landscape.</td></tr>';
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
            rosterBody.innerHTML = '<tr><td colspan="6" class="empty-row">Load a save file in the Recruit Explorer tab to see the national landscape.</td></tr>';
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
            powerRankings.innerHTML = '<p class="empty-row">Load a save file in the Recruit Explorer tab to see power rankings.</p>';
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
            topTeamsContainer.innerHTML = '<p class="empty-row">Load a save file in the Recruit Explorer tab to see top teams.</p>';
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

    function computeRecruitTargetCandidates() {
        if (!allRecruits.length || !userTeamContext) return [];

        // Excluded positions are dropped before percentiles are computed, not
        // just filtered out of the final board - otherwise their presence
        // would still shift where everyone else lands in the ranking.
        const eligibleRecruits = allRecruits.filter(r => !EXCLUDED_TARGET_POSITIONS.has(r.position));

        const positionNeeds = computePositionNeeds();
        const talentPercentiles = ordinalPercentiles(eligibleRecruits, r => r.rawRating);
        const nilPercentiles = ordinalPercentiles(eligibleRecruits, r => r.nilAdjustment);

        return eligibleRecruits.map((r, i) => {
            const need = positionNeeds.get(r.position) || { needScore: 0 };
            const geo = geoFitScore(r);
            const interestScore = r.userTeamInterest != null ? clamp(r.userTeamInterest, 0, 100) : 0;
            const gemAdj = r.gem === 'GEM' ? 8 : (r.gem === 'BUST' ? -8 : 0);
            const talentPercentile = talentPercentiles[i];
            const nilPercentile = nilPercentiles[i];

            return {
                recruit: r,
                needScore: need.needScore,
                needInfo: need,
                talentPercentile,
                nilPercentile,
                interestScore,
                geoScore: geo.score,
                geoLabel: geo.label,
                // Day One: talent and need dominate - this recruit has to be
                // both great and walking into a real opening.
                dayOneScore: 0.45 * talentPercentile + 0.30 * need.needScore + 0.15 * interestScore + 0.10 * geo.score + gemAdj,
                // Program Movers: need, talent, NIL value, and interest balanced.
                programMoverScore: 0.30 * need.needScore + 0.25 * talentPercentile + 0.20 * nilPercentile + 0.15 * interestScore + 0.10 * geo.score + gemAdj,
                // Foundational: NIL value and need dominate over raw
                // immediate talent - the affordable, long-term roster builders.
                foundationalScore: 0.30 * nilPercentile + 0.25 * need.needScore + 0.20 * talentPercentile + 0.15 * interestScore + 0.10 * geo.score + gemAdj
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

        const used = new Set();

        // Day One Starters must be blue-chip caliber (4-5 stars, or a top-20
        // national rank at their position) - talent and need drive the order.
        const dayOneEligible = candidates.filter(c => c.recruit.starsNum >= 4 || c.recruit.posRank <= 20);
        const dayOne = selectTopWithPositionCap(dayOneEligible, 'dayOneScore', 5, 1);
        dayOne.forEach(c => used.add(c.recruit.rank));

        const programMovers = selectTopWithPositionCap(
            candidates.filter(c => !used.has(c.recruit.rank)), 'programMoverScore', 10, 2
        );
        programMovers.forEach(c => used.add(c.recruit.rank));

        const foundational = selectTopWithPositionCap(
            candidates.filter(c => !used.has(c.recruit.rank)), 'foundationalScore', 20, 3
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

    function renderTeamContextSummary() {
        if (!userTeamContext) { teamContextSummary.innerHTML = ''; return; }
        const t = userTeamContext;
        const anyPlayer = allRosterPlayers.find(p => p.teamName === t.name);
        const tierLabel = anyPlayer ? anyPlayer.prestigeTierLabel : `Prestige ${t.prestige}`;

        teamContextSummary.innerHTML = [
            ['Program Tier', tierLabel, 'accent'],
            ['Remaining Budget', `${t.budget.remaining} pts`, ''],
            ['Budget Grade', t.grades.budget || 'N/A', ''],
            ['Conf. Prestige Grade', t.grades.conferencePrestige || 'N/A', ''],
            ['Brand Exposure Grade', t.grades.brandExposure || 'N/A', ''],
            ['Program Traditions Grade', t.grades.programTraditions || 'N/A', ''],
            ['Stadium Atmosphere Grade', t.grades.stadiumAtmosphere || 'N/A', ''],
            ['Facilities Level', `${t.facilitiesLevel || 0} / 5`, '']
        ].map(([label, value, cls]) => `
            <div class="context-card">
                <div class="context-label">${label}</div>
                <div class="context-value ${cls}">${escapeHtml(String(value))}</div>
            </div>
        `).join('');
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
            targetsContainer.innerHTML = '<p class="empty-row">Load a save file in the Recruit Explorer tab to see recruit targets.</p>';
            return;
        }

        targetsTitle.textContent = `🎯 Recruit Targets for ${userTeamContext.name}`;
        renderTeamContextSummary();

        const { dayOne, programMovers, foundational } = assignRecruitTiers();

        const sections = [
            {
                title: '🌱 Foundational Players', count: '20',
                hint: 'Inexpensive from an NIL perspective, a good fit for a real position need, and projected to become starters within 2-3 seasons — the picks that keep the program going.',
                candidates: foundational
            },
            {
                title: '📈 Program Movers', count: '10',
                hint: 'Positional needs and clear upgrades over the players currently there, NIL budget-friendly, and projected to start within a year or two.',
                candidates: programMovers
            },
            {
                title: '⭐ Day One Starters', count: '5',
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

        filteredSorted.sort((a, b) => {
            let av = a[sortKey], bv = b[sortKey];
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
                <td class="rating-cell ${ratingClass(r.rawRating)}">${r.rawRating.toFixed(2)}</td>
                <td class="rating-cell ${ratingClass(r.nilAdjustedRating)}">${r.nilAdjustedRating.toFixed(2)}</td>
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
})();
