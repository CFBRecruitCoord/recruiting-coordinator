const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Defaults to a folder inside the repo (fine for personal/local use, where
// nothing needs to survive a redeploy). In hosted mode this MUST point at a
// persistent volume instead - most hosting platforms wipe local disk on
// every deploy, which would silently delete every user account otherwise.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'auth.db');

let db = null;

/**
 * Accounts + sessions for the hosted (multi-tenant) mode. Deliberately kept
 * out of any dynasty-data database - this file only ever holds emails,
 * password hashes, and opaque session tokens, nothing about a user's save
 * files. SQLite is a fine fit at this stage (same choice already proven in
 * Dynasty Tracker's lib/db.js) - it's a straightforward swap for a hosted
 * Postgres instance later if/when running more than one server process.
 */
function getAuthDb() {
    if (db) return db;

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            trial_ends_at TEXT,
            subscription_status TEXT NOT NULL DEFAULT 'none',
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );

        -- Usage stats for the admin tab - deliberately just counts/metadata
        -- (who, when, whether it succeeded, how many recruits/players it
        -- found), never the parsed save data itself. That still lives
        -- entirely in browser memory per-request, same as always. visitor_id
        -- is the fallback attribution for the (now-typical) case of an
        -- anonymous upload - see the migration below for existing databases
        -- that predate this column.
        CREATE TABLE IF NOT EXISTS upload_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            visitor_id TEXT,
            created_at TEXT NOT NULL,
            success INTEGER NOT NULL,
            recruit_count INTEGER,
            roster_count INTEGER,
            error_message TEXT
        );

        -- User-submitted comments/bug reports, reviewed from the admin tab.
        -- page_context is a free-text hint of which tab the user was on
        -- (set by the feedback page's dropdown), not a hard reference to
        -- anything - purely informational for whoever reviews it.
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            page_context TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            created_at TEXT NOT NULL
        );

        -- Anonymous unique-visitor counter for the admin tab - covers
        -- everyone who lands on the site, not just people who create an
        -- account. visitor_id is a random ID in a non-identifying cookie
        -- (see lib/visitors.js), never an email/IP/anything personal. The
        -- (visitor_id, visit_date) unique index caps this at one row per
        -- visitor per calendar day, regardless of how many pages they load.
        CREATE TABLE IF NOT EXISTS site_visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visitor_id TEXT NOT NULL,
            visit_date TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        -- Coaching Career / Rivalries & Records. The save file only exposes a
        -- small rolling window of recent game results (not a permanent
        -- archive), so this is built up ourselves across many uploads over a
        -- dynasty's lifetime - same "accumulate what the game doesn't"
        -- pattern already proven in the original local Dynasty Tracker build
        -- this was ported from. user_id here is deliberately NOT a foreign
        -- key against users(id): personal mode has no login at all, and uses
        -- the reserved sentinel 0 ("the local dynasty") instead of a real
        -- user id, which would violate a real FK constraint. Hosted mode
        -- always uses a real user id - this feature requires an account
        -- there (see dynastyRecordsGate in server.js), both because tracking
        -- a career over time needs a durable identity a cookie can't give,
        -- and because it's exactly the kind of feature worth an account.
        CREATE TABLE IF NOT EXISTS dynasty_teams_meta (
            user_id INTEGER NOT NULL,
            team_index INTEGER NOT NULL,
            name TEXT, mascot TEXT, abbr TEXT,
            color_primary TEXT, color_secondary TEXT, state TEXT,
            PRIMARY KEY (user_id, team_index)
        );

        -- Every real (non-playoff) bowl slot the save knows about, so a bowl
        -- never played yet can still show up at 0-0 instead of being omitted.
        CREATE TABLE IF NOT EXISTS dynasty_bowls_meta (
            user_id INTEGER NOT NULL,
            bowl_index INTEGER NOT NULL,
            name TEXT,
            PRIMARY KEY (user_id, bowl_index)
        );

        -- One row per completed game the user's team has played, deduplicated
        -- on (user_id, season_year, season_week, opponent_team_index) so
        -- re-uploading a save whose rolling results window overlaps an
        -- earlier upload just re-confirms those games instead of duplicating
        -- them. Deliberately lean (W-L/score only, no box-score stat columns)
        -- since Every School/Bowl Games/Playoffs only ever need records, not
        -- stats - keeps each row tiny given this grows for as long as a
        -- dynasty (and the hosted account) is alive.
        CREATE TABLE IF NOT EXISTS dynasty_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            season_year INTEGER NOT NULL,
            season_week INTEGER NOT NULL,
            opponent_team_index INTEGER NOT NULL,
            is_home INTEGER NOT NULL,
            my_score INTEGER,
            opp_score INTEGER,
            result TEXT,
            is_bowl INTEGER,
            is_playoff INTEGER DEFAULT 0,
            bowl_index INTEGER,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, season_year, season_week, opponent_team_index)
        );

        -- Top 25 Poll. Unlike dynasty_games, most of what a snapshot needs
        -- (season-cumulative yards/TDs/sacks/turnovers, win-loss) is already
        -- computed and stored BY THE SAVE ITSELF on each team's TeamStats
        -- record - no need to reconstruct it from individual games. What the
        -- save doesn't retain is WEEKLY granularity (only "current" and the
        -- final tallies of the last few completed seasons), so this table
        -- exists purely to remember what a user's own current season looked
        -- like week-to-week as they play through it. A completed season's
        -- FINAL standings get a synthetic row with season_week = -1 (a
        -- season always has real weeks >= 0, so -1 is an unambiguous "final"
        -- marker) rather than one snapshot per historical week, since the
        -- save only ever exposes that season's end state, not its history.
        -- data is a JSON-encoded array (the ranked rows) rather than a
        -- normalized table - it's small (~30 rows), always read/written as a
        -- whole, and never queried by field, so JSON avoids ~30 rows of
        -- schema per snapshot for no real benefit.
        CREATE TABLE IF NOT EXISTS dynasty_top25_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            season_year INTEGER NOT NULL,
            season_week INTEGER NOT NULL,
            season_stage TEXT,
            computed_at TEXT NOT NULL,
            data TEXT NOT NULL,
            UNIQUE(user_id, season_year, season_week)
        );

        -- Recruiting class history, scoped to just the user's own team (not
        -- national - there's no reporting need for anyone else's classes,
        -- and 138 teams' worth would be a real storage cost for no benefit).
        -- A signee's recruiting star rating is permanently retained on their
        -- player record for as long as they're on a roster (verified: a
        -- Senior still carries their true original ProspectStarRating), so
        -- "this dynasty year's true Freshmen on my roster" IS that year's
        -- signing class - no need to separately track the recruiting board
        -- (which only shows the CURRENT cycle and would miss decommits/
        -- late flips resolving after an earlier upload). Re-ingested every
        -- upload/refresh for the current year, so it just keeps refining
        -- until those players age into Sophomores, after which the row for
        -- that year stops changing - the natural "final" state. avg_stars/
        -- signee_count/blue_chip_count are pulled out as real columns (not
        -- buried in the JSON) purely so a class-history trend view doesn't
        -- need to parse every row's JSON just to plot one number per year.
        -- team_index is the school THAT class signed with - a coach can
        -- change jobs across a dynasty (see the coaching-carousel feature),
        -- so this is what lets career totals be filtered/attributed by
        -- school and signee badges show the colors of the school they
        -- actually signed with, not whichever team the coach is at now.
        CREATE TABLE IF NOT EXISTS dynasty_recruiting_classes (
            user_id INTEGER NOT NULL,
            class_year INTEGER NOT NULL,
            team_index INTEGER NOT NULL DEFAULT -1,
            computed_at TEXT NOT NULL,
            signee_count INTEGER NOT NULL,
            avg_stars REAL,
            blue_chip_count INTEGER NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (user_id, class_year)
        );

        -- Best Players: the user's own notable (starter-caliber) players
        -- across their whole coaching career, so a program's all-time
        -- standouts survive past a player's eligibility instead of only
        -- ever being visible while they're on the current roster. Scoped to
        -- STARTERS only (same starter-slot logic as National Power
        -- Rankings) rather than every rostered player - a full ~85-man
        -- roster accumulated over many dynasty years would be mostly bench
        -- players nobody would ever look up here, so this keeps growth tied
        -- to who could plausibly belong on a "best players" list at all.
        -- player_key is a composite of bio fields set once at player
        -- generation and never changed after (name/position/height/weight/
        -- hometown - see parseNotablePlayers.js) - the save's own
        -- PLYR_ASSETNAME looked like a real per-player id but is empty for
        -- the generated majority of a college roster, so it wasn't usable.
        -- peak_overall only ever ratchets upward on
        -- re-ingest (see ingestNotablePlayers); stats is that player's
        -- latest known CAREER totals from the save's own CareerStats
        -- record, which are already cumulative and monotonic while they're
        -- on this roster, so the latest read is always the right one to
        -- keep - no need to merge field by field.
        CREATE TABLE IF NOT EXISTS dynasty_notable_players (
            user_id INTEGER NOT NULL,
            player_key TEXT NOT NULL,
            name TEXT NOT NULL,
            position TEXT NOT NULL,
            team_index INTEGER NOT NULL,
            peak_overall INTEGER NOT NULL,
            last_school_year TEXT,
            stats TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, player_key)
        );

        -- Awards: end-of-season winners for all 24 tracked awards (Heisman
        -- plus 21 other player awards and Best Head/Assistant Coach), one
        -- row per (award, year). The save's own LeagueHistoryAward table
        -- already retains a deep, growing multi-year history (confirmed:
        -- every completed season adds another block, not a fixed rolling
        -- window like TeamStats) with winner name/team already resolved -
        -- nothing to reconstruct - but it's still re-ingested every upload
        -- the same as everything else, both to survive past whatever the
        -- save's own capacity eventually allows and to give the frontend
        -- one consistent, always-fast local source instead of depending on
        -- a fresh parse every read. One row per (award, year) is about as
        -- lean as this data gets - no JSON blob needed.
        CREATE TABLE IF NOT EXISTS dynasty_awards_history (
            user_id INTEGER NOT NULL,
            award_type TEXT NOT NULL,
            award_year INTEGER NOT NULL,
            winner_name TEXT,
            winner_position TEXT,
            team_index INTEGER,
            computed_at TEXT NOT NULL,
            PRIMARY KEY (user_id, award_type, award_year)
        );

        -- Current Heisman race, week by week - the one award with a real
        -- in-season leaderboard (HeismanAwardRanking in the save); every
        -- other award only ever has a final winner (dynasty_awards_history
        -- above), not a "current standings." Same shape/reasoning as
        -- dynasty_top25_snapshots: the save only exposes the CURRENT week's
        -- candidates, so week-by-week history has to be built up ourselves.
        CREATE TABLE IF NOT EXISTS dynasty_heisman_race_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            season_year INTEGER NOT NULL,
            season_week INTEGER NOT NULL,
            season_stage TEXT,
            computed_at TEXT NOT NULL,
            data TEXT NOT NULL,
            UNIQUE(user_id, season_year, season_week)
        );

        -- All-Americans: 1st/2nd Team selections, both the true national
        -- team (ALL_AM_1ST/ALL_AM_2ND in the save - confirmed sparse, only
        -- 8-18 real slots filled some years rather than a full ~25-man
        -- team, but that's genuinely what the save tracks) and the fuller
        -- per-conference All-Conference teams (ALL_AM_1ST_CONF/
        -- ALL_AM_2ND_CONF). Preseason variants and Freshman All-American
        -- are deliberately not captured here - out of scope per the user's
        -- own ask. Lives in the save's PlayerAward table, a shared rolling
        -- buffer across many award types (unlike LeagueHistoryAward's clean
        -- dedicated history), so retention for any one type is short and
        -- inconsistent - re-ingesting every upload is what actually builds
        -- up a real multi-year history here, more so than for the other
        -- awards. player_key is name+position+team_index (unique enough
        -- within one year/scope/team bucket - two same-named players at the
        -- same position on the same team honored in the same category the
        -- same year is not a realistic collision).
        CREATE TABLE IF NOT EXISTS dynasty_all_american_selections (
            user_id INTEGER NOT NULL,
            scope TEXT NOT NULL,
            team TEXT NOT NULL,
            year INTEGER NOT NULL,
            player_key TEXT NOT NULL,
            player_name TEXT,
            position TEXT,
            team_index INTEGER,
            conference TEXT,
            computed_at TEXT NOT NULL,
            PRIMARY KEY (user_id, scope, team, year, player_key)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_upload_events_created ON upload_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_site_visits_visitor_date ON site_visits(visitor_id, visit_date);
        CREATE INDEX IF NOT EXISTS idx_site_visits_created ON site_visits(created_at);
        CREATE INDEX IF NOT EXISTS idx_dynasty_games_user ON dynasty_games(user_id);
        CREATE INDEX IF NOT EXISTS idx_dynasty_games_opponent ON dynasty_games(user_id, opponent_team_index);
        CREATE INDEX IF NOT EXISTS idx_top25_user_year ON dynasty_top25_snapshots(user_id, season_year, season_week);
        CREATE INDEX IF NOT EXISTS idx_awards_history_user_year ON dynasty_awards_history(user_id, award_year);
        CREATE INDEX IF NOT EXISTS idx_heisman_snapshots_user_year ON dynasty_heisman_race_snapshots(user_id, season_year, season_week);
        CREATE INDEX IF NOT EXISTS idx_all_american_user_scope_year ON dynasty_all_american_selections(user_id, scope, year);
    `);

    // Lightweight migration: CREATE TABLE IF NOT EXISTS above doesn't add
    // columns to a table that already exists from a prior deploy, and the
    // production database already has upload_events without visitor_id.
    // PRAGMA table_info lets this check safely before ALTERing, so it's a
    // no-op on every startup after the first.
    const uploadEventsColumns = db.prepare('PRAGMA table_info(upload_events)').all().map(c => c.name);
    if (!uploadEventsColumns.includes('visitor_id')) {
        db.exec('ALTER TABLE upload_events ADD COLUMN visitor_id TEXT');
    }

    // Same reasoning - dynasty_recruiting_classes shipped before team_index
    // existed (before coaching-carousel/school-filter support was added).
    const recruitingClassColumns = db.prepare('PRAGMA table_info(dynasty_recruiting_classes)').all().map(c => c.name);
    if (!recruitingClassColumns.includes('team_index')) {
        db.exec('ALTER TABLE dynasty_recruiting_classes ADD COLUMN team_index INTEGER NOT NULL DEFAULT -1');
    }

    return db;
}

module.exports = { getAuthDb, DB_PATH };
