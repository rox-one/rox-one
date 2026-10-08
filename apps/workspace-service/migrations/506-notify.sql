-- W1-05 (issue #1502) · 06-notify · file 506-notify.sql
-- DATA-MODEL §5.10 (notifications), §9.2, §12. Owner module: notify.
-- Notification kinds are the §9.2 vocabulary (v2.1 adds reminder_due).
CREATE TABLE notification (
  notification_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  kind text NOT NULL CHECK (kind IN ('mention', 'assignment', 'comment', 'check_in_due', 'check_in_submitted',
    'check_in_acknowledged', 'retrospective', 'task_due', 'task_overdue', 'milestone_due', 'kpi_update_due',
    'doc_shared', 'access_request', 'chat_invite', 'space_invite', 'event_invite', 'event_reminder',
    'im_message', 'meeting_started', 'approval_request', 'agent_report', 'suggestion', 'comment_reply',
    'thread_resolved', 'reminder_due', 'invite_pending', 'quota_warning', 'rule_failed')),
  subject_kind text,
  subject_id text,
  actor_id uuid REFERENCES principal(principal_id),
  payload jsonb NOT NULL DEFAULT '{}',
  email_state text CHECK (email_state IN ('held', 'queued', 'sent', 'skipped')),
  read_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Inbox feed: newest first per recipient; quick panel "unread" filter.
CREATE INDEX notification_inbox ON notification (principal_id, created_at DESC);
CREATE INDEX notification_unread ON notification (principal_id) WHERE read_at IS NULL;

CREATE TABLE notification_pref (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  kind text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  channels text[] NOT NULL DEFAULT '{inbox}',
  batch_minutes integer NOT NULL DEFAULT 5 CHECK (batch_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT notification_pref_identity PRIMARY KEY (workspace_id, principal_id, kind)
);

CREATE TABLE notification_email_batch (
  batch_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  window_minutes integer NOT NULL DEFAULT 5 CHECK (window_minutes > 0),
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  send_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX notification_email_batch_due ON notification_email_batch (status, send_at) WHERE status = 'pending';
