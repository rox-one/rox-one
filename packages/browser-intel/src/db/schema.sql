-- Browser Intelligence Pipeline — canonical schema.
--
-- Applied by `initIntelligenceSchema()` in `database.ts`. The file is the single
-- source of truth for the on-disk shape; TypeScript consumers read records
-- through `repositories.ts` so no SQL is written outside this package.
--
-- Durability contract (requirement C): WAL journaling with synchronous=NORMAL.
-- The pragmas themselves are executed by `database.ts` before this script runs,
-- because `PRAGMA journal_mode` cannot be set inside a transaction. They are
-- repeated here as documentation of the invariants the pipeline relies on:
--
--   PRAGMA journal_mode = WAL;
--   PRAGMA synchronous = NORMAL;
--
-- Timestamps are epoch milliseconds (UTC) unless a column name says otherwise.
-- `guid`/`visit_key` style text keys are unique per (profile, event) so a
-- repeated ingest of the same profile is idempotent.

-- ---------------------------------------------------------------------------
-- Browser/profile inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS browser_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      TEXT    NOT NULL UNIQUE,
  vendor          TEXT    NOT NULL,
  family          TEXT    NOT NULL,
  display_name    TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  path            TEXT    NOT NULL,
  last_used_at    INTEGER,
  state           TEXT    NOT NULL DEFAULT 'ok',
  stores_json     TEXT    NOT NULL DEFAULT '{}',
  detected_at     INTEGER NOT NULL,
  last_scanned_at INTEGER,
  last_staged_at  INTEGER,
  last_ingested_at INTEGER,
  visit_count     INTEGER NOT NULL DEFAULT 0,
  bookmark_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_browser_profiles_vendor ON browser_profiles(vendor);

-- ---------------------------------------------------------------------------
-- URL dimension (deduplicated raw URLs + unfurl status tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_urls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT    NOT NULL UNIQUE,
  raw_url         TEXT    NOT NULL,
  scheme          TEXT,
  host            TEXT,
  domain          TEXT,
  path            TEXT,
  query           TEXT,
  fragment        TEXT,
  -- 'pending' | 'done' | 'error' | 'skipped'
  unfurl_status   TEXT    NOT NULL DEFAULT 'pending',
  unfurl_attempts INTEGER NOT NULL DEFAULT 0,
  unfurl_error    TEXT,
  unfurl_cpu_ms   INTEGER,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  visit_count     INTEGER NOT NULL DEFAULT 0,
  bookmark_count  INTEGER NOT NULL DEFAULT 0,
  search_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dim_urls_status ON dim_urls(unfurl_status, id);
CREATE INDEX IF NOT EXISTS idx_dim_urls_domain ON dim_urls(domain);
CREATE INDEX IF NOT EXISTS idx_dim_urls_last_seen ON dim_urls(last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- Visit facts (full Hindsight event log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_visits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      TEXT    NOT NULL REFERENCES browser_profiles(profile_id) ON DELETE CASCADE,
  url_id          INTEGER NOT NULL REFERENCES dim_urls(id) ON DELETE CASCADE,
  visit_time      INTEGER NOT NULL,
  visit_time_utc  TEXT,
  -- Missing transitions are stored as '' (never NULL): SQLite treats NULLs as
  -- distinct in the UNIQUE index below, which would defeat re-ingest dedupe.
  transition_type TEXT    NOT NULL DEFAULT '',
  visit_duration  INTEGER,
  visit_source    TEXT,
  visit_count     INTEGER,
  typed_count     INTEGER,
  search_query    TEXT,
  is_bookmark     INTEGER NOT NULL DEFAULT 0,
  title           TEXT,
  source          TEXT    NOT NULL DEFAULT 'hindsight',
  ingested_at     INTEGER NOT NULL,
  -- Idempotent re-ingest: one row per (profile, url, instant, visit source).
  UNIQUE (profile_id, url_id, visit_time, transition_type)
);

CREATE INDEX IF NOT EXISTS idx_fact_visits_time ON fact_visits(visit_time DESC);
CREATE INDEX IF NOT EXISTS idx_fact_visits_url ON fact_visits(url_id);
CREATE INDEX IF NOT EXISTS idx_fact_visits_profile ON fact_visits(profile_id);
CREATE INDEX IF NOT EXISTS idx_fact_visits_search ON fact_visits(search_query);

-- ---------------------------------------------------------------------------
-- Unfurl details (JSON-decoded AST/DAG + Cytoscape graph)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unfurl_details (
  url_id          INTEGER PRIMARY KEY REFERENCES dim_urls(id) ON DELETE CASCADE,
  decoded_json    TEXT    NOT NULL DEFAULT '{}',
  graph_json      TEXT    NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  tokens_json     TEXT    NOT NULL DEFAULT '[]',
  timestamps_json TEXT    NOT NULL DEFAULT '[]',
  identifiers_json TEXT   NOT NULL DEFAULT '[]',
  node_count      INTEGER NOT NULL DEFAULT 0,
  edge_count      INTEGER NOT NULL DEFAULT 0,
  token_count     INTEGER NOT NULL DEFAULT 0,
  depth           INTEGER NOT NULL DEFAULT 0,
  truncated       INTEGER NOT NULL DEFAULT 0,
  cpu_ms          INTEGER NOT NULL DEFAULT 0,
  unfurl_version  TEXT    NOT NULL,
  decoded_at      INTEGER NOT NULL,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_unfurl_details_decoded_at ON unfurl_details(decoded_at DESC);
CREATE INDEX IF NOT EXISTS idx_unfurl_details_nodes ON unfurl_details(node_count DESC);

-- ---------------------------------------------------------------------------
-- Temporal aggregations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timeline_daily (
  day              TEXT    PRIMARY KEY,
  visits           INTEGER NOT NULL DEFAULT 0,
  unique_urls      INTEGER NOT NULL DEFAULT 0,
  unique_domains   INTEGER NOT NULL DEFAULT 0,
  bookmarks        INTEGER NOT NULL DEFAULT 0,
  searches         INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  top_domain       TEXT,
  computed_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_monthly (
  month            TEXT    PRIMARY KEY,
  visits           INTEGER NOT NULL DEFAULT 0,
  unique_urls      INTEGER NOT NULL DEFAULT 0,
  unique_domains   INTEGER NOT NULL DEFAULT 0,
  bookmarks        INTEGER NOT NULL DEFAULT 0,
  searches         INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  top_domain       TEXT,
  computed_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_yearly (
  year             TEXT    PRIMARY KEY,
  visits           INTEGER NOT NULL DEFAULT 0,
  unique_urls      INTEGER NOT NULL DEFAULT 0,
  unique_domains   INTEGER NOT NULL DEFAULT 0,
  bookmarks        INTEGER NOT NULL DEFAULT 0,
  searches         INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  top_domain       TEXT,
  computed_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Agent memory slots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profile_slots (
  slot        TEXT    PRIMARY KEY,
  value_json  TEXT    NOT NULL,
  confidence  REAL    NOT NULL DEFAULT 0,
  source      TEXT    NOT NULL DEFAULT 'synthesis',
  evidence_json TEXT  NOT NULL DEFAULT '[]',
  model       TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_profile_slots_updated ON user_profile_slots(updated_at DESC);

-- ---------------------------------------------------------------------------
-- Pipeline bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);