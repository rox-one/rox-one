-- W1-05 (issue #1502) · 51-workplace · file 551-workplace.sql
-- DATA-MODEL §5.10 (workplace adopted), §12. Owner module: workplace.
CREATE TABLE workplace_app (
  app_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  icon text,
  entry_url text,
  category text,
  enabled boolean NOT NULL DEFAULT true,
  sort_key text NOT NULL DEFAULT 'm',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX workplace_app_workspace ON workplace_app (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE workplace_favorite (
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  app_id uuid NOT NULL REFERENCES workplace_app(app_id),
  sort_key text NOT NULL DEFAULT 'm',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workplace_favorite_identity PRIMARY KEY (principal_id, app_id)
);
