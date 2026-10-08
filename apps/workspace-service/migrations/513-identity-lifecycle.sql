-- W1-05 (issue #1502) · 13-identity-lifecycle · file 513-identity-lifecycle.sql
-- DATA-MODEL §5.11 (team chats D-v2-2, placeholder principals), §5.12 (personal agent), §12.
-- Owner modules: identity (directory), agents (agent_binding).
-- Extends: principal (status, primary_email), workspace (general_chat_id),
-- workspace_member (status), chat (system_role, posting_policy, invite_policy, archived_at).
ALTER TABLE principal ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'placeholder', 'deactivated')),
  ADD COLUMN primary_email public.citext,
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN invited_by uuid REFERENCES principal(principal_id);
CREATE UNIQUE INDEX principal_email_uniq ON principal (primary_email)
  WHERE primary_email IS NOT NULL AND status <> 'deactivated';

ALTER TABLE workspace ADD COLUMN general_chat_id uuid;

ALTER TABLE workspace_member ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'left', 'removed')),
  ADD COLUMN joined_at timestamptz;
CREATE INDEX workspace_member_status ON workspace_member (workspace_id, status);

CREATE TABLE invitation (
  invitation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  email public.citext NOT NULL,
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  invited_by uuid NOT NULL REFERENCES principal(principal_id),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'guest')),
  targets jsonb NOT NULL DEFAULT '[]',
  token_hash bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired', 'bounced')),
  message text,
  sent_at timestamptz,
  last_reminded_at timestamptz,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX invitation_pending_uniq ON invitation (workspace_id, email) WHERE status = 'pending';
CREATE INDEX invitation_principal ON invitation (principal_id);

-- Team chats (D-v2-2): extends the v1 chat definition from 512.
ALTER TABLE chat ADD COLUMN system_role text CHECK (system_role IN ('general')),
  ADD COLUMN posting_policy text NOT NULL DEFAULT 'all' CHECK (posting_policy IN ('all', 'admins')),
  ADD COLUMN invite_policy text NOT NULL DEFAULT 'members' CHECK (invite_policy IN ('members', 'admins')),
  ADD COLUMN archived_at timestamptz;
CREATE UNIQUE INDEX chat_general_uniq ON chat (workspace_id) WHERE system_role = 'general';
ALTER TABLE chat ADD CONSTRAINT chat_general_public
  CHECK (system_role IS NULL OR (kind = 'group' AND visibility = 'public'));
-- Public chat discovery («Обзор чатов»); quick panel for joinable chats.
CREATE INDEX chat_public_browse ON chat (workspace_id, kind)
  WHERE visibility = 'public' AND archived_at IS NULL AND deleted_at IS NULL;

-- Personal agent per member (@rox). principal.kind = 'bot'. Owner module: agents.
CREATE TABLE agent_binding (
  agent_principal_id uuid PRIMARY KEY REFERENCES principal(principal_id),
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  handle text NOT NULL,
  display_name text NOT NULL,
  runtime text NOT NULL DEFAULT 'omp' CHECK (runtime IN ('omp', 'external')),
  dm_chat_id uuid REFERENCES chat(chat_id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  policy_id uuid,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, owner_principal_id)
);
CREATE INDEX agent_binding_owner ON agent_binding (owner_principal_id) WHERE status = 'active';

-- Seed: system bot principal (deterministic id, idempotent).
-- Operately-style system actor for rule (R1–R5) and migration provenance.
INSERT INTO principal (principal_id, kind, status)
  VALUES ('00000000-0000-0000-0000-000000000b07', 'bot', 'active')
  ON CONFLICT (principal_id) DO NOTHING;
