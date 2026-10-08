-- W1-05 (issue #1502) · 05-events · file 505-events.sql
-- DATA-MODEL §5.10 (events), §9.1, §12. Owner module: commands (event bus).
-- Generalises project_event / project_create_receipt (those tables stay for compatibility).
CREATE TABLE domain_event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  type text NOT NULL CHECK (length(type) > 0),
  actor_id uuid REFERENCES principal(principal_id),
  subject_kind text,
  subject_id text,
  aggregate_revision bigint NOT NULL DEFAULT 0 CHECK (aggregate_revision >= 0),
  policy_epoch bigint NOT NULL DEFAULT 1 CHECK (policy_epoch > 0),
  causation_id text,
  correlation_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX domain_event_replay ON domain_event (workspace_id, sequence);
CREATE INDEX domain_event_subject ON domain_event (subject_kind, subject_id);
CREATE INDEX domain_event_type ON domain_event (workspace_id, type, sequence);

CREATE TABLE command_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 256),
  actor_principal_id uuid REFERENCES principal(principal_id),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  observed_revision bigint NOT NULL DEFAULT 0 CHECK (observed_revision >= 0),
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT command_receipt_identity PRIMARY KEY (workspace_id, idempotency_key),
  UNIQUE (workspace_id, command_id)
);

-- Opaque server cursors survive reconnect and never trust client-provided offsets.
CREATE TABLE realtime_cursor (
  cursor_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  topic text NOT NULL CHECK (length(topic) > 0),
  policy_epoch bigint NOT NULL DEFAULT 1 CHECK (policy_epoch > 0),
  position jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX realtime_cursor_expiry ON realtime_cursor (expires_at);
