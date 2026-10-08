-- W1-05 (issue #1502) · 23-projects · file 523-projects.sql
-- DATA-MODEL §5.5 (extends the existing Rox project additively), §12. Owner module: projects.
-- Every ADD COLUMN is nullable or has a DEFAULT so existing rows stay valid.
ALTER TABLE project ADD COLUMN slug text,
  ADD COLUMN space_id uuid,
  ADD COLUMN parent_goal_id uuid,
  ADD COLUMN champion_id uuid,
  ADD COLUMN reviewer_id uuid,
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  ADD COLUMN description jsonb,
  ADD COLUMN roadmap jsonb,
  ADD COLUMN started_at date,
  ADD COLUMN deadline date,
  ADD COLUMN deadline_precision text DEFAULT 'day',
  ADD COLUMN check_in_cadence text NOT NULL DEFAULT 'weekly',
  ADD COLUMN next_check_in_due_at timestamptz,
  ADD COLUMN last_check_in_id uuid,
  ADD COLUMN last_check_in_status text,
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN success_status text CHECK (success_status IN ('achieved', 'missed')),
  ADD COLUMN task_list_id uuid;
CREATE INDEX project_space ON project (workspace_id, space_id) WHERE deleted_at IS NULL;
CREATE INDEX project_status_due ON project (workspace_id, status, next_check_in_due_at) WHERE deleted_at IS NULL;

CREATE TABLE project_member (
  project_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  role text NOT NULL CHECK (role IN ('champion', 'reviewer', 'contributor')),
  responsibility text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT project_member_identity PRIMARY KEY (project_id, principal_id, role)
);
CREATE INDEX project_member_principal ON project_member (principal_id);

CREATE TABLE milestone (
  milestone_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  roadmap_status text CHECK (roadmap_status IN ('planned', 'active', 'done', 'blocked')),
  start_on date,
  due_on date,
  due_precision text DEFAULT 'day',
  completed_at timestamptz,
  stages jsonb NOT NULL DEFAULT '[]',
  sort_key text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX milestone_project ON milestone (project_id) WHERE deleted_at IS NULL;
