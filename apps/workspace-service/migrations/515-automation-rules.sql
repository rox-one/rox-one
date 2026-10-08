-- W1-05 (issue #1502) · 15-automation-rules · file 515-automation-rules.sql
-- DATA-MODEL §5.16 (domain rules R1–R5; not the Automations canvas, not an orchestrator),
-- §12. Owner module: automation.
CREATE TABLE automation_rule (
  automation_rule_id uuid PRIMARY KEY,
  rule_id text NOT NULL CHECK (length(rule_id) > 0),
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  enabled boolean NOT NULL DEFAULT true,
  params jsonb NOT NULL DEFAULT '{}',
  scope text NOT NULL DEFAULT 'workspace' CHECK (scope IN ('workspace', 'principal')),
  principal_id uuid REFERENCES principal(principal_id),
  updated_by uuid REFERENCES principal(principal_id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX automation_rule_uniq ON automation_rule
  (workspace_id, rule_id, COALESCE(principal_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE rule_execution (
  rule_execution_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  rule_id text NOT NULL CHECK (length(rule_id) > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
  source_event_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partially_succeeded', 'failed', 'skipped')),
  steps jsonb NOT NULL DEFAULT '[]',
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);
CREATE INDEX rule_execution_status ON rule_execution (workspace_id, rule_id, status);
