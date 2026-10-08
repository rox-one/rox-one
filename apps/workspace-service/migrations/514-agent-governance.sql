-- W1-05 (issue #1502) · 14-agent-governance · file 514-agent-governance.sql
-- DATA-MODEL §5.13 (audit log), §5.14 (grants, approval policy, standing approvals,
-- rate limits), §12. Owner module: agents.
CREATE TABLE audit_log (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  actor_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'bot', 'system', 'rule')),
  on_behalf_of uuid REFERENCES principal(principal_id),
  command_type text NOT NULL CHECK (length(command_type) > 0),
  target_ref text,
  decision text NOT NULL CHECK (decision IN ('executed', 'proposed', 'approved', 'rejected', 'expired', 'denied', 'rate_limited', 'failed', 'undone')),
  risk_class text NOT NULL CHECK (risk_class IN ('routine', 'consequential', 'privileged')),
  approval_request_id uuid,
  rule_execution_id uuid,
  provenance jsonb NOT NULL DEFAULT '{}',
  request_hash bytea NOT NULL,
  receipt jsonb,
  error text,
  prev_hash bytea,
  hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_by_actor ON audit_log (workspace_id, actor_principal_id, created_at DESC);
CREATE INDEX audit_by_target ON audit_log (workspace_id, target_ref) WHERE target_ref IS NOT NULL;
CREATE INDEX audit_by_workspace ON audit_log (workspace_id, seq DESC);

CREATE TABLE agent_grant (
  agent_grant_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  agent_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  scope text NOT NULL CHECK (length(scope) > 0),
  selector jsonb NOT NULL DEFAULT '{}',
  granted_by uuid NOT NULL REFERENCES principal(principal_id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);
CREATE INDEX agent_grant_agent ON agent_grant (agent_principal_id) WHERE revoked_at IS NULL;

CREATE TABLE approval_policy (
  policy_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  rules jsonb NOT NULL DEFAULT '[]',
  workspace_floor jsonb NOT NULL DEFAULT '{}',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, owner_principal_id)
);

CREATE TABLE approval_request (
  approval_request_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  agent_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  owner_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  command jsonb NOT NULL,
  risk_class text NOT NULL CHECK (risk_class IN ('routine', 'consequential', 'privileged')),
  summary text NOT NULL,
  preview jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  decided_by uuid REFERENCES principal(principal_id),
  decided_at timestamptz,
  remember jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Review surface "Needs your approval": pending requests per owner.
CREATE INDEX approval_request_pending ON approval_request (owner_principal_id, created_at DESC)
  WHERE status = 'pending';

CREATE TABLE standing_approval (
  standing_approval_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  agent_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  scope text NOT NULL CHECK (length(scope) > 0),
  selector jsonb NOT NULL DEFAULT '{}',
  created_from uuid REFERENCES approval_request(approval_request_id),
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);
CREATE INDEX standing_approval_agent ON standing_approval (agent_principal_id) WHERE revoked_at IS NULL;

CREATE TABLE rate_limit_policy (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  subject text NOT NULL CHECK (length(subject) > 0),
  scope text NOT NULL CHECK (length(scope) > 0),
  per_minute integer CHECK (per_minute IS NULL OR per_minute > 0),
  per_hour integer CHECK (per_hour IS NULL OR per_hour > 0),
  per_day integer CHECK (per_day IS NULL OR per_day > 0),
  CONSTRAINT rate_limit_policy_identity PRIMARY KEY (workspace_id, subject, scope)
);
