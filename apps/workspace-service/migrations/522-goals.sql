-- W1-05 (issue #1502) · 22-goals · file 522-goals.sql
-- DATA-MODEL §5.4 (ADR-U03), §12. Owner module: goals.
-- Alignment (Lark okr_alignment) is entity_link 'aligned-to'; no extra table.
CREATE TABLE okr_cycle (
  okr_cycle_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  time_zone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  origin_project_id uuid,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX okr_cycle_workspace ON okr_cycle (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE goal (
  goal_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  scope text NOT NULL CHECK (scope IN ('company', 'space', 'personal')),
  space_id uuid,
  parent_goal_id uuid REFERENCES goal(goal_id),
  goal_kind text NOT NULL DEFAULT 'goal' CHECK (goal_kind IN ('goal', 'objective')),
  okr_cycle_id uuid REFERENCES okr_cycle(okr_cycle_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description jsonb,
  champion_id uuid REFERENCES principal(principal_id),
  reviewer_id uuid REFERENCES principal(principal_id),
  creator_id uuid NOT NULL REFERENCES principal(principal_id),
  start_on date,
  start_precision text DEFAULT 'day',
  due_on date,
  due_precision text NOT NULL DEFAULT 'day' CHECK (due_precision IN ('day', 'month', 'quarter', 'year')),
  weight numeric(6, 3),
  sort_key text NOT NULL DEFAULT 'm',
  publish_state text NOT NULL DEFAULT 'published' CHECK (publish_state IN ('draft', 'published')),
  last_check_in_id uuid,
  last_check_in_status text CHECK (last_check_in_status IN ('on_track', 'caution', 'off_track')),
  next_check_in_due_at timestamptz,
  check_in_cadence text NOT NULL DEFAULT 'monthly'
    CHECK (check_in_cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'none')),
  closed_at timestamptz,
  success_status text CHECK (success_status IN ('achieved', 'missed')),
  closed_by uuid REFERENCES principal(principal_id),
  archived_at timestamptz,
  progress_cache numeric(5, 4),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
-- Work map: goals by space/cycle/parent; quick panels: champion workload.
CREATE INDEX goal_space ON goal (workspace_id, space_id) WHERE deleted_at IS NULL;
CREATE INDEX goal_parent ON goal (parent_goal_id) WHERE parent_goal_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX goal_cycle ON goal (okr_cycle_id) WHERE okr_cycle_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX goal_champion ON goal (champion_id) WHERE champion_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX goal_check_in_due ON goal (next_check_in_due_at) WHERE next_check_in_due_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE goal_target (
  goal_target_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goal(goal_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  from_value double precision NOT NULL,
  to_value double precision NOT NULL,
  value double precision,
  unit text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT 'increase' CHECK (direction IN ('increase', 'decrease')),
  weight numeric(6, 3),
  status_override text CHECK (status_override IN ('on_track', 'caution', 'off_track', 'pending')),
  owner_id uuid REFERENCES principal(principal_id),
  evidence jsonb NOT NULL DEFAULT '[]',
  measured_at timestamptz,
  freshness_days integer,
  sort_key text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX goal_target_goal ON goal_target (goal_id) WHERE deleted_at IS NULL;

CREATE TABLE goal_check (
  goal_check_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goal(goal_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid REFERENCES principal(principal_id),
  weight numeric(6, 3),
  evidence jsonb NOT NULL DEFAULT '[]',
  sort_key text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX goal_check_goal ON goal_check (goal_id) WHERE deleted_at IS NULL;
