-- W1-05 (issue #1502) · 17-collab · file 517-collab.sql
-- DATA-MODEL §5.17 (suggestions, views, calendar sharing), §12. Owner module: collab.
-- v2 columns for comment / doc / task_list / work_item_user_state live in their v1 files
-- (508, 510, 520) per §12. calendar_member.calendar_id REFERENCES calendar is added in
-- 521-calendar.sql (calendar sorts later); presence/typing stay ephemeral (Valkey).
CREATE TABLE doc_suggestion (
  suggestion_id uuid PRIMARY KEY,
  doc_id uuid NOT NULL REFERENCES doc(doc_id),
  author_id uuid NOT NULL REFERENCES principal(principal_id),
  kind text NOT NULL CHECK (kind IN ('insert', 'delete', 'replace', 'format', 'block')),
  anchor jsonb NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'stale')),
  decided_by uuid REFERENCES principal(principal_id),
  decided_at timestamptz,
  thread_comment_id uuid REFERENCES comment(comment_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX doc_suggestion_open ON doc_suggestion (doc_id) WHERE status = 'open';

-- "Viewed by" receipts for docs.
CREATE TABLE doc_view (
  doc_id uuid NOT NULL REFERENCES doc(doc_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  first_viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  view_count integer NOT NULL DEFAULT 1 CHECK (view_count > 0),
  CONSTRAINT doc_view_identity PRIMARY KEY (doc_id, principal_id)
);

CREATE TABLE calendar_member (
  calendar_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('principal', 'space', 'channel', 'workspace')),
  subject_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer', 'free_busy')),
  color text,
  visible boolean NOT NULL DEFAULT true,
  notify boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT calendar_member_identity PRIMARY KEY (calendar_id, subject_type, subject_id)
);
CREATE INDEX calendar_member_subject ON calendar_member (subject_type, subject_id);
