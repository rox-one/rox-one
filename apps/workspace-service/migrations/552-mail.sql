-- W1-05 (issue #1502) · 52-mail · file 552-mail.sql
-- DATA-MODEL §5.10 (mail adopted), §12. Owner module: mail.
-- Mail bodies live in Stalwart (external authority); this table binds a workspace
-- account/identity to its provider mailbox for notifications and send-as.
CREATE TABLE mail_account (
  account_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  provider text NOT NULL DEFAULT 'stalwart' CHECK (provider IN ('stalwart', 'google', 'outlook')),
  email public.citext NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, principal_id, email)
);
CREATE INDEX mail_account_principal ON mail_account (principal_id) WHERE deleted_at IS NULL;
