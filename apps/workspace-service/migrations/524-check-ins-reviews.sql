-- W1-05 (issue #1502) · 24-check-ins-reviews · file 524-check-ins-reviews.sql
-- DATA-MODEL §5.6, §12. Owner module: goals (check-ins shared with projects).
CREATE TABLE check_in (
  check_in_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  subject_type text NOT NULL CHECK (subject_type IN ('goal', 'project')),
  subject_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES principal(principal_id),
  status text NOT NULL CHECK (status IN ('on_track', 'caution', 'off_track', 'pending')),
  message jsonb NOT NULL,
  target_snapshot jsonb,
  check_snapshot jsonb,
  due_date_change jsonb,
  source text NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'kr_update', 'agent_draft', 'import')),
  state text NOT NULL DEFAULT 'published' CHECK (state IN ('draft', 'scheduled', 'published')),
  scheduled_at timestamptz,
  published_at timestamptz,
  notify text NOT NULL DEFAULT 'everyone' CHECK (notify IN ('everyone', 'selected', 'none')),
  acknowledged_by uuid REFERENCES principal(principal_id),
  acknowledged_at timestamptz,
  editable_until timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
-- Review surface: check-ins per subject, newest first.
CREATE INDEX check_in_subject ON check_in (subject_type, subject_id, created_at DESC) WHERE deleted_at IS NULL;
-- "Needs your review": unacknowledged published check-ins on the subjects the viewer
-- reviews (project.reviewer_id / goal.reviewer_id), newest first:
--   WHERE workspace_id = $ws AND subject_type = $t AND subject_id = ANY($reviewed_ids)
--     AND acknowledged_at IS NULL AND state = 'published' AND deleted_at IS NULL
--   ORDER BY created_at DESC
CREATE INDEX check_in_pending_ack ON check_in (workspace_id, subject_type, subject_id, created_at DESC)
  WHERE acknowledged_at IS NULL AND state = 'published' AND deleted_at IS NULL;

CREATE TABLE review (
  review_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  subject_type text NOT NULL CHECK (subject_type IN ('goal', 'project', 'okr_cycle')),
  subject_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES principal(principal_id),
  success_status text CHECK (success_status IN ('achieved', 'missed')),
  notes jsonb,
  doc_id uuid REFERENCES doc(doc_id),
  score jsonb,
  acknowledged_by uuid REFERENCES principal(principal_id),
  acknowledged_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX review_subject ON review (subject_type, subject_id) WHERE deleted_at IS NULL;
