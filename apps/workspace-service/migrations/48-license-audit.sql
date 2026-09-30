-- Release-only aggregate and receipts; no user content or identity mutation.
CREATE TABLE license_component (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id), resource_id uuid NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 256),
  binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[a-f0-9]{64}$'),
  sbom_digest text NOT NULL CHECK (sbom_digest ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0), policy_epoch bigint NOT NULL DEFAULT 1 CHECK (policy_epoch > 0),
  can_read boolean NOT NULL, can_write boolean NOT NULL, can_action boolean NOT NULL,
  evidence jsonb, audit_digest text, audited_at timestamptz, projection_watermark bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, resource_id), CHECK ((evidence IS NULL) = (audit_digest IS NULL)),
  CHECK ((evidence IS NULL) = (audited_at IS NULL)), CHECK ((revision = 0) = (evidence IS NULL)),
  CHECK (audit_digest IS NULL OR audit_digest ~ '^[a-f0-9]{64}$')
);
CREATE TABLE license_audit_receipt (
  workspace_id uuid NOT NULL, resource_id uuid NOT NULL, actor_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 256), idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  receipt_id uuid NOT NULL UNIQUE, request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^[a-f0-9]{64}$'), artifact_digest text NOT NULL, sbom_digest text NOT NULL,
  review_revision text NOT NULL, review_sha256 text NOT NULL, checker_revision text NOT NULL, checker_sha256 text NOT NULL, build_sha256 text NOT NULL,
  aggregate_revision bigint NOT NULL, policy_epoch bigint NOT NULL, event_id uuid NOT NULL REFERENCES project_event(event_id),
  projection_watermark bigint NOT NULL, audit_digest text NOT NULL, evidence jsonb NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (event_id), UNIQUE (workspace_id, resource_id, aggregate_revision),
  PRIMARY KEY (workspace_id, actor_principal_id, idempotency_key), UNIQUE (workspace_id, actor_principal_id, command_id),
  FOREIGN KEY (workspace_id, resource_id) REFERENCES license_component(workspace_id, resource_id)
);
ALTER TABLE project_event DROP CONSTRAINT project_event_type_check;
ALTER TABLE project_event ADD CONSTRAINT project_event_type_check CHECK (type IN ('workspace.member_joined','project.created','audit.license_reviewed'));
ALTER TABLE project_query_cursor DROP CONSTRAINT project_query_cursor_kind_check;
ALTER TABLE project_query_cursor ADD CONSTRAINT project_query_cursor_kind_check CHECK (kind IN ('projects','events','license-list','license-events'));
