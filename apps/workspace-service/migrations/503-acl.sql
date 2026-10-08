-- W1-05 (issue #1502) · 03-acl · file 503-acl.sql
-- DATA-MODEL §8, §12. Owner module: acl.
-- Role lattice (DATA-MODEL §8.1): owner > manager > editor > commenter > viewer > minimal,
-- plus Lark special roles follower / guest / free_busy.
-- Subject types (DATA-MODEL §8.1): principal | department | channel | space | workspace | link.
CREATE TABLE acl_entry (
  acl_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  resource_type text NOT NULL CHECK (resource_type IN ('channel', 'note', 'folder', 'wiki-space', 'task-list', 'task',
    'calendar', 'base', 'form', 'okr-cycle', 'goal', 'project', 'space', 'kpi', 'project-template', 'doc', 'file', 'drive-link')),
  resource_id text NOT NULL CHECK (length(resource_id) > 0),
  subject_type text NOT NULL CHECK (subject_type IN ('principal', 'department', 'channel', 'space', 'workspace', 'link')),
  subject_id text NOT NULL CHECK (length(subject_id) > 0),
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'editor', 'commenter', 'viewer', 'minimal', 'follower', 'guest', 'free_busy')),
  granted_by uuid REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (resource_type, resource_id, subject_type, subject_id)
);
CREATE INDEX acl_by_resource ON acl_entry (resource_type, resource_id);
CREATE INDEX acl_by_subject ON acl_entry (workspace_id, subject_type, subject_id);

-- resource_policy holds privacy presets and list-wide defaults (DATA-MODEL §8.2.4).
-- policy: {default_access, notify_everyone, who_manage_collaborators, ...}.
CREATE TABLE resource_policy (
  policy_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  resource_type text NOT NULL,
  resource_id text NOT NULL CHECK (length(resource_id) > 0),
  default_subject text CHECK (default_subject IN ('space', 'workspace', 'link')),
  default_role text CHECK (default_role IN ('viewer', 'commenter', 'editor')),
  policy jsonb NOT NULL DEFAULT '{}',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (resource_type, resource_id)
);
CREATE INDEX resource_policy_workspace ON resource_policy (workspace_id, resource_type);
