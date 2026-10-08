-- W1-05 (issue #1502) · 20-work-item · file 520-work-item.sql
-- DATA-MODEL §5.1 (WorkItem v3), §5.17 (v2 task_list + work_item_user_state columns
-- folded into this v1 file per §12), §12. Owner module: tasks.
CREATE TABLE work_item (
  work_item_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  notes_md text NOT NULL DEFAULT '',
  notes_doc jsonb,
  parent_id uuid REFERENCES work_item(work_item_id),
  project_id uuid,
  milestone_id uuid,
  space_id uuid,
  status_set_owner text NOT NULL DEFAULT 'workspace',
  status_key text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'none' CHECK (priority IN ('none', 'low', 'normal', 'high', 'urgent')),
  size text CHECK (size IN ('xs', 's', 'm', 'l', 'xl')),
  start_at timestamptz,
  due_at timestamptz,
  due_precision text NOT NULL DEFAULT 'day' CHECK (due_precision IN ('day', 'month', 'quarter', 'year')),
  recurrence jsonb,
  repeat_of uuid REFERENCES work_item(work_item_id),
  checklist jsonb NOT NULL DEFAULT '[]',
  tags text[] NOT NULL DEFAULT '{}',
  custom_fields jsonb NOT NULL DEFAULT '{}',
  estimate_minutes integer CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0),
  reminder_offsets integer[] NOT NULL DEFAULT '{}',
  reminder_on_dates date[] NOT NULL DEFAULT '{}',
  remind_due_day boolean NOT NULL DEFAULT false,
  remind_overdue boolean NOT NULL DEFAULT false,
  origin_ref text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  reopened_at timestamptz,
  archived_at timestamptz,
  schema_version integer NOT NULL DEFAULT 3 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  -- project's PK is (workspace_id, project_id) (01-domain-contract), so the FK carries the
  -- workspace: no task on another workspace's project or on a missing one. milestone sorts
  -- later; its FK (work_item_milestone_fk, milestone of the task's own project) and the
  -- milestone-needs-project CHECK are added in 523-projects.sql.
  CONSTRAINT work_item_project_fk FOREIGN KEY (workspace_id, project_id) REFERENCES project(workspace_id, project_id)
);
-- Work map + task boards: scope filters. work_item_project / work_item_milestone are partial
-- (live rows only), so a future hard purge of projects / milestones needs non-partial indexes.
CREATE INDEX work_item_space ON work_item (workspace_id, space_id) WHERE deleted_at IS NULL;
CREATE INDEX work_item_project ON work_item (workspace_id, project_id) WHERE project_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX work_item_milestone ON work_item (milestone_id) WHERE milestone_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX work_item_status ON work_item (workspace_id, status_key) WHERE deleted_at IS NULL;
CREATE INDEX work_item_owner ON work_item (owner_principal_id) WHERE deleted_at IS NULL;

CREATE TABLE work_item_member (
  work_item_id uuid NOT NULL REFERENCES work_item(work_item_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  role text NOT NULL CHECK (role IN ('assignee')),
  added_by uuid REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_item_member_identity PRIMARY KEY (work_item_id, principal_id, role)
);
CREATE INDEX work_item_member_principal ON work_item_member (principal_id);

CREATE TABLE work_item_user_state (
  work_item_id uuid NOT NULL REFERENCES work_item(work_item_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  list text NOT NULL DEFAULT 'anytime' CHECK (list IN ('inbox', 'today', 'upcoming', 'anytime', 'someday')),
  start_at timestamptz,
  evening boolean NOT NULL DEFAULT false,
  sort_key text NOT NULL DEFAULT 'm',
  hidden boolean NOT NULL DEFAULT false,
  seen_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  CONSTRAINT work_item_user_state_identity PRIMARY KEY (work_item_id, principal_id)
);
CREATE INDEX work_item_user_state_today ON work_item_user_state (principal_id, list) WHERE hidden = false;

CREATE TABLE task_list (
  task_list_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_type text NOT NULL CHECK (owner_type IN ('user', 'project', 'space', 'chat')),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  notes text,
  deadline_at timestamptz,
  group_id uuid,
  sort_key text NOT NULL DEFAULT 'm',
  status_set_enabled boolean NOT NULL DEFAULT false,
  system_role text CHECK (system_role IN ('backlog', 'inbox', 'space_board', 'project_board')),
  share_mode text NOT NULL DEFAULT 'private' CHECK (share_mode IN ('private', 'members', 'space', 'workspace')),
  completed_at timestamptz,
  archived_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
-- owner_id may be a project id, which is unique only per workspace (project PK).
CREATE INDEX task_list_owner ON task_list (workspace_id, owner_type, owner_id) WHERE deleted_at IS NULL;
-- One backlog / inbox per user PER WORKSPACE (a principal can belong to several).
CREATE UNIQUE INDEX task_list_system_role_uniq ON task_list (workspace_id, owner_id, system_role)
  WHERE system_role IS NOT NULL AND owner_type = 'user' AND deleted_at IS NULL;

CREATE TABLE task_section (
  task_section_id uuid PRIMARY KEY,
  task_list_id uuid NOT NULL REFERENCES task_list(task_list_id),
  title text NOT NULL,
  sort_key text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX task_section_list ON task_section (task_list_id) WHERE deleted_at IS NULL;

CREATE TABLE task_list_group (
  task_list_group_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  sort_key text NOT NULL,
  collapsed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE TABLE task_in_list (
  work_item_id uuid NOT NULL REFERENCES work_item(work_item_id),
  task_list_id uuid NOT NULL REFERENCES task_list(task_list_id),
  task_section_id uuid REFERENCES task_section(task_section_id),
  sort_key text NOT NULL,
  added_by uuid REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT task_in_list_identity PRIMARY KEY (work_item_id, task_list_id)
);
CREATE INDEX task_in_list_cover ON task_in_list (task_list_id, sort_key);

CREATE TABLE task_status (
  workspace_id uuid NOT NULL,
  set_owner_type text NOT NULL CHECK (set_owner_type IN ('workspace', 'project', 'space', 'task_list')),
  set_owner_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  key text NOT NULL CHECK (length(key) > 0),
  label text NOT NULL,
  color text NOT NULL CHECK (color IN ('gray', 'blue', 'green', 'red', 'amber', 'purple')),
  icon text NOT NULL DEFAULT 'circle',
  closed boolean NOT NULL DEFAULT false,
  kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'done', 'canceled')),
  sort_key text NOT NULL,
  CONSTRAINT task_status_identity PRIMARY KEY (workspace_id, set_owner_type, set_owner_id, key)
);

-- Seed: canonical workspace-default status template set (DATA-MODEL §5.1; Operately §3.3).
-- Workspace-scoped rows are cloned from this nil-workspace template by workspace provisioning;
-- task_status.workspace_id intentionally has no FK so the template can exist pre-workspace.
INSERT INTO task_status (workspace_id, set_owner_type, set_owner_id, key, label, color, icon, closed, kind, sort_key)
  VALUES
  ('00000000-0000-0000-0000-000000000000', 'workspace', '00000000-0000-0000-0000-000000000000', 'pending', 'Not started', 'gray', 'circle', false, 'open', 'a'),
  ('00000000-0000-0000-0000-000000000000', 'workspace', '00000000-0000-0000-0000-000000000000', 'in_progress', 'In progress', 'blue', 'circle-dot', false, 'open', 'b'),
  ('00000000-0000-0000-0000-000000000000', 'workspace', '00000000-0000-0000-0000-000000000000', 'done', 'Done', 'green', 'check-circle', true, 'done', 'c'),
  ('00000000-0000-0000-0000-000000000000', 'workspace', '00000000-0000-0000-0000-000000000000', 'canceled', 'Canceled', 'red', 'x-circle', true, 'canceled', 'd')
  ON CONFLICT (workspace_id, set_owner_type, set_owner_id, key) DO NOTHING;
