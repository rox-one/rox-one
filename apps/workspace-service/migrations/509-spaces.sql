-- W1-05 (issue #1502) · 09-spaces · file 509-spaces.sql
-- DATA-MODEL §5.7, §12. Owner module: spaces.
-- chat_id / root_folder_id / wiki_space_id reference tables created in 511/512,
-- so the FK constraints are added at the end of 512-im.sql (see migrations/README.md).
CREATE TABLE space (
  space_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  purpose text,
  icon text,
  color text,
  is_company_space boolean NOT NULL DEFAULT false,
  tools jsonb NOT NULL DEFAULT '{"goals_projects":true,"discussions":true,"docs":true,"tasks":true,"kpis":false,"templates":false}',
  chat_id uuid NOT NULL,
  root_folder_id uuid NOT NULL,
  wiki_space_id uuid,
  default_access text NOT NULL DEFAULT 'members'
    CHECK (default_access IN ('members', 'company_view', 'company_comment', 'company_edit')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  deleted_at timestamptz
);
-- Work map scope: spaces of a workspace.
CREATE INDEX space_workspace ON space (workspace_id) WHERE deleted_at IS NULL;
