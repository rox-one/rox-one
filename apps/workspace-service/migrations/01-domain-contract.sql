-- Additive private Project bootstrap. Apply in the authority's selected schema,
-- inside its migration transaction. No local stores or future registry tables are touched.
CREATE TABLE principal (
  principal_id uuid PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE TABLE auth_subject_alias (
  issuer text NOT NULL CHECK (length(issuer) > 0),
  subject text NOT NULL CHECK (length(subject) > 0),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX auth_subject_principal ON auth_subject_alias(principal_id);

CREATE TABLE workspace (
  workspace_id uuid PRIMARY KEY,
  owner_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 10000),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  policy_epoch bigint NOT NULL DEFAULT 1 CHECK (policy_epoch > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE TABLE workspace_member (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT workspace_member_identity PRIMARY KEY (workspace_id, principal_id)
);

CREATE TABLE project (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  project_id uuid NOT NULL,
  owner_principal_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 10000),
  visibility text NOT NULL CHECK (visibility IN ('private', 'members')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT project_identity PRIMARY KEY (workspace_id, project_id),
  FOREIGN KEY (workspace_id, owner_principal_id) REFERENCES workspace_member(workspace_id, principal_id)
);
CREATE INDEX project_authorized_page ON project(workspace_id, created_at, project_id) WHERE deleted_at IS NULL;

CREATE TABLE project_create_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  actor_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 256),
  receipt_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  observed_revision bigint NOT NULL CHECK (observed_revision >= 0),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT bootstrap_receipt PRIMARY KEY (workspace_id, actor_principal_id, idempotency_key),
  UNIQUE (workspace_id, actor_principal_id, command_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES project(workspace_id, project_id)
);

-- Minimal transaction outbox/inbox, deliberately independent of WP-04's general framework.
CREATE TABLE project_event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  project_id uuid,
  actor_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  type text NOT NULL CHECK (type IN ('workspace.member_joined', 'project.created')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  aggregate_revision bigint NOT NULL CHECK (aggregate_revision >= 0),
  policy_epoch bigint NOT NULL CHECK (policy_epoch > 0),
  causation_id text NOT NULL,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, type, causation_id, actor_principal_id),
  CHECK ((type = 'project.created') = (project_id IS NOT NULL)),
  FOREIGN KEY (workspace_id, project_id) REFERENCES project(workspace_id, project_id)
);
CREATE INDEX project_event_replay ON project_event(workspace_id, sequence);

CREATE TABLE project_event_inbox (
  consumer_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES project_event(event_id),
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer_id, event_id)
);
CREATE TABLE project_projection_watermark (
  consumer_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer_id, workspace_id)
);

-- Opaque server cursors survive reconnect and never trust client-provided offsets or identity.
CREATE TABLE project_query_cursor (
  cursor_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  kind text NOT NULL CHECK (kind IN ('projects', 'events')),
  policy_epoch bigint NOT NULL CHECK (policy_epoch > 0),
  position jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX project_cursor_expiry ON project_query_cursor(expires_at);
