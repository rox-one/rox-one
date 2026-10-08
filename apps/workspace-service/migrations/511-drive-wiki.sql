-- W1-05 (issue #1502) · 11-drive-wiki · file 511-drive-wiki.sql
-- DATA-MODEL §5.2, §12. Owner module: drive (folders, links, recents), wiki.
CREATE TABLE folder (
  folder_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  parent_id uuid REFERENCES folder(folder_id),
  owner_type text NOT NULL CHECK (owner_type IN ('user', 'space', 'goal', 'project', 'chat', 'workspace')),
  owner_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX folder_workspace ON folder (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX folder_parent ON folder (parent_id) WHERE deleted_at IS NULL;

CREATE TABLE folder_item (
  folder_id uuid NOT NULL REFERENCES folder(folder_id),
  item_ref text NOT NULL CHECK (length(item_ref) > 0),
  is_shortcut boolean NOT NULL DEFAULT false,
  sort_key text NOT NULL DEFAULT 'm',
  added_by uuid REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT folder_item_identity PRIMARY KEY (folder_id, item_ref)
);

CREATE TABLE drive_link (
  drive_link_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  folder_id uuid REFERENCES folder(folder_id),
  url text NOT NULL CHECK (length(url) > 0),
  link_type text NOT NULL DEFAULT 'other'
    CHECK (link_type IN ('airtable', 'dropbox', 'figma', 'google', 'google_doc', 'google_sheet', 'google_slides', 'notion', 'other')),
  title text NOT NULL,
  description jsonb,
  author_id uuid REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX drive_link_folder ON drive_link (folder_id) WHERE deleted_at IS NULL;

CREATE TABLE wiki_space (
  wiki_space_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  icon text,
  space_id uuid,
  home_doc_id uuid,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX wiki_space_workspace ON wiki_space (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE wiki_node (
  wiki_space_id uuid NOT NULL REFERENCES wiki_space(wiki_space_id),
  node_ref text NOT NULL CHECK (length(node_ref) > 0),
  parent_ref text,
  sort_key text NOT NULL DEFAULT 'm',
  CONSTRAINT wiki_node_identity PRIMARY KEY (wiki_space_id, node_ref)
);

-- Recents / favourites are per workspace: item_ref is free text and a principal can
-- belong to several workspaces, so the keys lead with workspace_id (README "Tenant scoping").
CREATE TABLE drive_recent (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  item_ref text NOT NULL CHECK (length(item_ref) > 0),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT drive_recent_identity PRIMARY KEY (workspace_id, principal_id, item_ref)
);

CREATE TABLE drive_favorite (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  item_ref text NOT NULL CHECK (length(item_ref) > 0),
  sort_key text NOT NULL DEFAULT 'm',
  CONSTRAINT drive_favorite_identity PRIMARY KEY (workspace_id, principal_id, item_ref)
);
