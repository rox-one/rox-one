-- W1-05 (issue #1502) · 26-templates · file 526-templates.sql
-- DATA-MODEL §5.7, §12. Owner module: projects (templates).
CREATE TABLE project_template (
  project_template_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  space_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  payload jsonb NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX project_template_workspace ON project_template (workspace_id) WHERE archived_at IS NULL;
