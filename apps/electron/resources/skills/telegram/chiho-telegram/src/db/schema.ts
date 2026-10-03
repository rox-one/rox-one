export const APP_SCHEMA_VERSION = 2;

export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001_init',
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id bigserial PRIMARY KEY,
  label text NOT NULL UNIQUE,
  session_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS peers (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  peer_kind text NOT NULL,
  username text NULL,
  display_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, peer_id)
);

CREATE TABLE IF NOT EXISTS dialogs (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  last_message_id integer NULL,
  last_message_at timestamptz NULL,
  unread_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, peer_id),
  FOREIGN KEY (account_id, peer_id) REFERENCES peers(account_id, peer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  message_id integer NOT NULL,
  sent_at timestamptz NOT NULL,
  sender_peer_id bigint NULL,
  text text NOT NULL,
  is_service boolean NOT NULL DEFAULT false,
  media_type text NULL,
  PRIMARY KEY (account_id, peer_id, message_id),
  FOREIGN KEY (account_id, peer_id) REFERENCES peers(account_id, peer_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS messages_by_peer_time
  ON messages(account_id, peer_id, sent_at DESC);
`,
  },
  {
    id: '002_crm',
    sql: `
CREATE TABLE IF NOT EXISTS tags (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, tag)
);

CREATE TABLE IF NOT EXISTS peer_tags (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  tag text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  confidence double precision NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, peer_id, tag),
  FOREIGN KEY (account_id, peer_id) REFERENCES peers(account_id, peer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS companies (
  company_id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS peer_company (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  company_id bigint NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  role text NULL,
  source text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, peer_id),
  FOREIGN KEY (account_id, peer_id) REFERENCES peers(account_id, peer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open',
  why text NOT NULL,
  priority text NOT NULL DEFAULT 'med',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, peer_id) REFERENCES peers(account_id, peer_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tasks_due_open_idx
  ON tasks(account_id, due_at)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS summaries (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  source_model text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, peer_id, kind),
  FOREIGN KEY (account_id, peer_id) REFERENCES peers(account_id, peer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  last_synced_message_id integer NULL,
  last_synced_at timestamptz NULL,
  last_run_at timestamptz NULL,
  error text NULL,
  PRIMARY KEY (account_id, peer_id),
  FOREIGN KEY (account_id, peer_id) REFERENCES peers(account_id, peer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_rules (
  rule_id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  contains_text text NOT NULL,
  set_tag text NULL,
  followup_days integer NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rule_events (
  event_id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_id bigint NOT NULL REFERENCES automation_rules(rule_id) ON DELETE CASCADE,
  peer_id bigint NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rule_events_created_idx
  ON rule_events(account_id, created_at DESC);
`,
  },
  {
    id: '003_rule_event_match_idempotency',
    sql: `
ALTER TABLE rule_events
  ADD COLUMN IF NOT EXISTS match_message_id integer NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rule_events_match_unique_idx
  ON rule_events(account_id, rule_id, peer_id, match_message_id)
  WHERE match_message_id IS NOT NULL;
`,
  },
  {
    id: '004_telegram_inventory_and_durable_sync',
    sql: `
CREATE TABLE IF NOT EXISTS telegram_inventory_state (
  account_id bigint PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  telegram_active_available_count integer NOT NULL DEFAULT 0,
  telegram_archived_available_count integer NOT NULL DEFAULT 0,
  crm_dialog_persisted_count integer NOT NULL DEFAULT 0,
  contact_persisted_count integer NOT NULL DEFAULT 0,
  active_contact_generation text NULL,
  last_dialog_sync_at timestamptz NULL,
  last_contact_sync_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_sync_runs (
  run_id text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('recent', 'full')),
  include_archived boolean NOT NULL,
  status text NOT NULL CHECK (
    status IN ('queued', 'running', 'waiting_for_telegram', 'enriching', 'complete', 'failed')
  ),
  phase text NOT NULL CHECK (
    phase IN ('active', 'archived', 'contacts', 'enrichment', 'complete')
  ),
  cursor_token text NULL,
  fetched_count integer NOT NULL DEFAULT 0,
  persisted_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  active_available_count integer NOT NULL DEFAULT 0,
  archived_available_count integer NOT NULL DEFAULT 0,
  resume_at timestamptz NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_sync_runs_one_active_per_account
  ON telegram_sync_runs(account_id)
  WHERE status IN ('queued', 'running', 'waiting_for_telegram', 'enriching');

CREATE INDEX IF NOT EXISTS telegram_sync_runs_account_updated
  ON telegram_sync_runs(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS telegram_dialog_index (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_kind text NOT NULL CHECK (peer_kind IN ('user', 'chat', 'channel', 'self')),
  peer_id text NOT NULL,
  display_name text NOT NULL,
  username text NULL,
  location text NOT NULL CHECK (location IN ('active', 'archived')),
  pinned boolean NOT NULL DEFAULT false,
  unread_count integer NOT NULL DEFAULT 0,
  last_message_id integer NULL,
  last_message_at timestamptz NULL,
  last_message_preview text NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  sync_run_id text NOT NULL REFERENCES telegram_sync_runs(run_id) ON DELETE RESTRICT,
  PRIMARY KEY (account_id, peer_kind, peer_id)
);

CREATE INDEX IF NOT EXISTS telegram_dialog_index_account_order
  ON telegram_dialog_index(account_id, last_message_at DESC, peer_kind, peer_id);

CREATE TABLE IF NOT EXISTS telegram_contacts (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot_generation text NOT NULL,
  peer_id text NOT NULL,
  display_name text NOT NULL,
  username text NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, snapshot_generation, peer_id)
);

CREATE INDEX IF NOT EXISTS telegram_contacts_generation_order
  ON telegram_contacts(account_id, snapshot_generation, display_name, peer_id);
`,
  },
  {
    id: '005_kind_aware_peer_identity',
    sql: `
ALTER TABLE dialogs ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_peer_kind text;
ALTER TABLE peer_tags ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE peer_company ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE summaries ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE sync_cursors ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE rule_events ADD COLUMN IF NOT EXISTS peer_kind text;
ALTER TABLE telegram_contacts ADD COLUMN IF NOT EXISTS peer_kind text;

-- mtcute marks channel and supergroup IDs below -10^12. Older rows stored every
-- non-user peer as "chat", so recover the canonical channel kind before child
-- rows inherit their parent's kind and the composite keys are rebuilt.
UPDATE peers
SET peer_kind = 'channel'
WHERE peer_kind = 'chat' AND peer_id < -1000000000000;

UPDATE dialogs child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE messages child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE peer_tags child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE peer_company child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE tasks child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE summaries child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE sync_cursors child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE rule_events child
SET peer_kind = parent.peer_kind
FROM peers parent
WHERE child.account_id = parent.account_id
  AND child.peer_id = parent.peer_id
  AND child.peer_kind IS NULL;

UPDATE telegram_contacts SET peer_kind = 'user' WHERE peer_kind IS NULL;

UPDATE dialogs SET peer_kind = 'chat' WHERE peer_kind IS NULL;
UPDATE messages SET peer_kind = 'chat' WHERE peer_kind IS NULL;
UPDATE peer_tags SET peer_kind = 'chat' WHERE peer_kind IS NULL;
UPDATE peer_company SET peer_kind = 'chat' WHERE peer_kind IS NULL;
UPDATE tasks SET peer_kind = 'chat' WHERE peer_kind IS NULL;
UPDATE summaries SET peer_kind = 'chat' WHERE peer_kind IS NULL;
UPDATE sync_cursors SET peer_kind = 'chat' WHERE peer_kind IS NULL;
UPDATE rule_events SET peer_kind = 'chat' WHERE peer_kind IS NULL;

ALTER TABLE dialogs ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE messages ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE peer_tags ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE peer_company ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE summaries ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE sync_cursors ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE rule_events ALTER COLUMN peer_kind SET NOT NULL;
ALTER TABLE telegram_contacts ALTER COLUMN peer_kind SET NOT NULL;

ALTER TABLE dialogs DROP CONSTRAINT IF EXISTS dialogs_account_id_peer_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_account_id_peer_id_fkey;
ALTER TABLE peer_tags DROP CONSTRAINT IF EXISTS peer_tags_account_id_peer_id_fkey;
ALTER TABLE peer_company DROP CONSTRAINT IF EXISTS peer_company_account_id_peer_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_account_id_peer_id_fkey;
ALTER TABLE summaries DROP CONSTRAINT IF EXISTS summaries_account_id_peer_id_fkey;
ALTER TABLE sync_cursors DROP CONSTRAINT IF EXISTS sync_cursors_account_id_peer_id_fkey;

ALTER TABLE dialogs DROP CONSTRAINT IF EXISTS dialogs_pkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_pkey;
ALTER TABLE peer_tags DROP CONSTRAINT IF EXISTS peer_tags_pkey;
ALTER TABLE peer_company DROP CONSTRAINT IF EXISTS peer_company_pkey;
ALTER TABLE summaries DROP CONSTRAINT IF EXISTS summaries_pkey;
ALTER TABLE sync_cursors DROP CONSTRAINT IF EXISTS sync_cursors_pkey;
ALTER TABLE telegram_contacts DROP CONSTRAINT IF EXISTS telegram_contacts_pkey;
ALTER TABLE peers DROP CONSTRAINT IF EXISTS peers_pkey;

ALTER TABLE peers ADD PRIMARY KEY (account_id, peer_kind, peer_id);
ALTER TABLE dialogs ADD PRIMARY KEY (account_id, peer_kind, peer_id);
ALTER TABLE messages ADD PRIMARY KEY (account_id, peer_kind, peer_id, message_id);
ALTER TABLE peer_tags ADD PRIMARY KEY (account_id, peer_kind, peer_id, tag);
ALTER TABLE peer_company ADD PRIMARY KEY (account_id, peer_kind, peer_id);
ALTER TABLE summaries ADD PRIMARY KEY (account_id, peer_kind, peer_id, kind);
ALTER TABLE sync_cursors ADD PRIMARY KEY (account_id, peer_kind, peer_id);
ALTER TABLE telegram_contacts
  ADD PRIMARY KEY (account_id, snapshot_generation, peer_kind, peer_id);

ALTER TABLE dialogs
  ADD FOREIGN KEY (account_id, peer_kind, peer_id)
  REFERENCES peers(account_id, peer_kind, peer_id) ON DELETE CASCADE;
ALTER TABLE messages
  ADD FOREIGN KEY (account_id, peer_kind, peer_id)
  REFERENCES peers(account_id, peer_kind, peer_id) ON DELETE CASCADE;
ALTER TABLE peer_tags
  ADD FOREIGN KEY (account_id, peer_kind, peer_id)
  REFERENCES peers(account_id, peer_kind, peer_id) ON DELETE CASCADE;
ALTER TABLE peer_company
  ADD FOREIGN KEY (account_id, peer_kind, peer_id)
  REFERENCES peers(account_id, peer_kind, peer_id) ON DELETE CASCADE;
ALTER TABLE tasks
  ADD FOREIGN KEY (account_id, peer_kind, peer_id)
  REFERENCES peers(account_id, peer_kind, peer_id) ON DELETE CASCADE;
ALTER TABLE summaries
  ADD FOREIGN KEY (account_id, peer_kind, peer_id)
  REFERENCES peers(account_id, peer_kind, peer_id) ON DELETE CASCADE;
ALTER TABLE sync_cursors
  ADD FOREIGN KEY (account_id, peer_kind, peer_id)
  REFERENCES peers(account_id, peer_kind, peer_id) ON DELETE CASCADE;

DROP INDEX IF EXISTS messages_by_peer_time;
CREATE INDEX messages_by_peer_time
  ON messages(account_id, peer_kind, peer_id, sent_at DESC);

DROP INDEX IF EXISTS rule_events_match_unique_idx;
CREATE UNIQUE INDEX rule_events_match_unique_idx
  ON rule_events(account_id, rule_id, peer_kind, peer_id, match_message_id)
  WHERE match_message_id IS NOT NULL;

DROP INDEX IF EXISTS telegram_contacts_generation_order;
CREATE INDEX telegram_contacts_generation_order
  ON telegram_contacts(
    account_id, snapshot_generation, display_name, peer_kind, peer_id
  );
`,
  },
];
