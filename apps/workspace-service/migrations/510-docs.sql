-- W1-05 (issue #1502) · 10-docs · file 510-docs.sql
-- DATA-MODEL §5.2, §5.17 (v2 doc columns folded into this v1 file per §12), §12.
-- Owner module: docs.
CREATE TABLE doc (
  doc_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_id uuid NOT NULL REFERENCES principal(principal_id),
  subtype text NOT NULL DEFAULT 'doc'
    CHECK (subtype IN ('doc', 'post', 'announcement', 'wiki-page', 'minutes', 'daily', 'template', 'check-in-body')),
  title text NOT NULL DEFAULT '',
  folder_id uuid,
  wiki_space_id uuid,
  parent_ref text,
  space_id uuid,
  state text NOT NULL DEFAULT 'published' CHECK (state IN ('draft', 'scheduled', 'published')),
  scheduled_at timestamptz,
  published_at timestamptz,
  source_note_ref text,
  migrated_from_local_at timestamptz,
  markdown_snapshot text NOT NULL DEFAULT '',
  snapshot_revision bigint NOT NULL DEFAULT 0 CHECK (snapshot_revision >= 0),
  snapshot_at timestamptz,
  public_token text UNIQUE,
  page_width text NOT NULL DEFAULT 'standard' CHECK (page_width IN ('standard', 'wide', 'full')),
  daily_date date,
  event_ref text,
  suggest_mode_default boolean NOT NULL DEFAULT false,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX doc_workspace ON doc (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX doc_folder ON doc (folder_id) WHERE deleted_at IS NULL;
CREATE INDEX doc_wiki ON doc (wiki_space_id) WHERE deleted_at IS NULL;
CREATE INDEX doc_space ON doc (space_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX doc_daily_uniq ON doc (owner_id, daily_date)
  WHERE subtype = 'daily' AND daily_date IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE doc_yjs_update (
  doc_id uuid NOT NULL REFERENCES doc(doc_id),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  update bytea NOT NULL,
  actor_id uuid REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT doc_yjs_update_identity PRIMARY KEY (doc_id, seq)
);

CREATE TABLE doc_snapshot (
  doc_id uuid NOT NULL REFERENCES doc(doc_id),
  version integer NOT NULL CHECK (version > 0),
  yjs_state bytea NOT NULL,
  markdown text NOT NULL,
  editor_id uuid REFERENCES principal(principal_id),
  origin text NOT NULL CHECK (origin IN ('created', 'edited', 'restored', 'migration', 'autosave')),
  restored_from integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT doc_snapshot_identity PRIMARY KEY (doc_id, version)
);
