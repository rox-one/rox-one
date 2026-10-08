-- W1-05 (issue #1502) · 08-social · file 508-social.sql
-- DATA-MODEL §5.8, §5.17 (v2 comment columns folded into this v1 file per §12),
-- §6.1 (relation vocabulary), §12. Owner module: social.
-- Server entity_link mirrors TECH-SPEC §3.2 (either endpoint workspace-authority).
CREATE TABLE entity_link (
  link_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  from_kind text NOT NULL CHECK (length(from_kind) > 0),
  from_id text NOT NULL CHECK (length(from_id) > 0),
  to_kind text NOT NULL CHECK (length(to_kind) > 0),
  to_id text NOT NULL CHECK (length(to_id) > 0),
  relation text NOT NULL CHECK (relation IN ('parent', 'mentions', 'blocks', 'assigned', 'in-calendar',
    'derived-from', 'attached-to', 'member-of', 'embeds', 'relates-to', 'aligned-to', 'resource-of')),
  role text,
  anchor jsonb,
  created_by uuid NOT NULL REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX entity_link_uniq ON entity_link
  (from_kind, from_id, relation, to_kind, to_id, COALESCE(role, '')) WHERE deleted_at IS NULL;
-- Backlinks panel + quick panels: to-side lookup.
CREATE INDEX entity_link_to ON entity_link (to_kind, to_id) WHERE deleted_at IS NULL;
CREATE INDEX entity_link_from ON entity_link (from_kind, from_id) WHERE deleted_at IS NULL;

CREATE TABLE comment (
  comment_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  resource_kind text NOT NULL CHECK (length(resource_kind) > 0),
  resource_id text NOT NULL CHECK (length(resource_id) > 0),
  author_id uuid NOT NULL REFERENCES principal(principal_id),
  content jsonb NOT NULL,
  anchor jsonb,
  parent_id uuid REFERENCES comment(comment_id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES principal(principal_id),
  thread_status text NOT NULL DEFAULT 'open' CHECK (thread_status IN ('open', 'resolved')),
  kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'suggestion_note', 'system')),
  mentions uuid[] NOT NULL DEFAULT '{}',
  edited_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX comment_by_resource ON comment (resource_kind, resource_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX comment_open_threads ON comment (resource_kind, resource_id) WHERE thread_status = 'open' AND deleted_at IS NULL;

CREATE TABLE reaction (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  resource_kind text NOT NULL CHECK (length(resource_kind) > 0),
  resource_id text NOT NULL CHECK (length(resource_id) > 0),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  emoji text NOT NULL CHECK (length(emoji) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reaction_identity PRIMARY KEY (resource_kind, resource_id, principal_id, emoji)
);
-- Replaces message_reaction; covering index for IM performance (DATA-MODEL §5.3).
CREATE INDEX reaction_covering ON reaction (resource_kind, resource_id, principal_id);

CREATE TABLE subscription (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  resource_kind text NOT NULL CHECK (length(resource_kind) > 0),
  resource_id text NOT NULL CHECK (length(resource_id) > 0),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  kind text NOT NULL CHECK (kind IN ('invited', 'joined', 'mentioned', 'follower', 'auto')),
  canceled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT subscription_identity PRIMARY KEY (resource_kind, resource_id, principal_id)
);
CREATE INDEX subscription_principal ON subscription (principal_id) WHERE canceled = false;
