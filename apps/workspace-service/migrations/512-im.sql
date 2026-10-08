-- W1-05 (issue #1502) · 12-im · file 512-im.sql
-- DATA-MODEL §5.3, §5.11 (v1 chat_member roles/states), §12. Owner module: messenger.
-- Kinds are channel / channel-message (ADR-U08); table names stay chat / message.
-- Team-chat v2 columns (system_role, posting_policy, invite_policy, archived_at)
-- land in 513-identity-lifecycle.sql per §12.
CREATE TABLE chat (
  chat_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  kind text NOT NULL CHECK (kind IN ('p2p', 'group', 'channel', 'topic_group', 'bot_p2p', 'space', 'entity')),
  visibility text NOT NULL CHECK (visibility IN ('private', 'public')),
  name text NOT NULL DEFAULT '',
  description text,
  space_id uuid,
  subject_ref text,
  created_by uuid REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX chat_workspace ON chat (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX chat_space ON chat (space_id) WHERE space_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE chat_member (
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'pending_activation', 'left', 'removed')),
  last_read_seq bigint NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chat_member_identity PRIMARY KEY (chat_id, principal_id)
);
CREATE INDEX chat_member_principal ON chat_member (principal_id) WHERE state = 'active';

CREATE TABLE message (
  message_id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  seq bigint NOT NULL CHECK (seq > 0),
  sender_id uuid REFERENCES principal(principal_id),
  content jsonb NOT NULL DEFAULT '{}',
  mentions uuid[] NOT NULL DEFAULT '{}',
  reply_to uuid REFERENCES message(message_id),
  edited_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (chat_id, seq)
);
-- Chat feed: newest-first page per chat.
CREATE INDEX message_feed ON message (chat_id, seq DESC) WHERE deleted_at IS NULL;

CREATE TABLE message_flag (
  message_id uuid NOT NULL REFERENCES message(message_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  flag text NOT NULL CHECK (flag IN ('saved', 'unread_mark', 'reminder')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_flag_identity PRIMARY KEY (message_id, principal_id, flag)
);

CREATE TABLE chat_pin (
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  message_id uuid NOT NULL REFERENCES message(message_id),
  pinned_by uuid REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chat_pin_identity PRIMARY KEY (chat_id, message_id)
);

CREATE TABLE chat_top_notice (
  chat_id uuid PRIMARY KEY REFERENCES chat(chat_id),
  content jsonb NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES principal(principal_id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Lark announcement = doc(subtype='announcement'); doc_id REFERENCES doc (510 < 512).
CREATE TABLE chat_announcement (
  announcement_id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  doc_id uuid REFERENCES doc(doc_id),
  created_by uuid REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX chat_announcement_chat ON chat_announcement (chat_id);

CREATE TABLE chat_tab (
  tab_id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  kind text NOT NULL CHECK (length(kind) > 0),
  title text NOT NULL DEFAULT '',
  ref text,
  sort_key text NOT NULL DEFAULT 'm',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX chat_tab_chat ON chat_tab (chat_id);

CREATE TABLE chat_label (
  label_id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  color text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE chat_label_item (
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  label_id uuid NOT NULL REFERENCES chat_label(label_id),
  message_id uuid NOT NULL REFERENCES message(message_id),
  CONSTRAINT chat_label_item_identity PRIMARY KEY (chat_id, label_id, message_id)
);

CREATE TABLE chat_member_event (
  event_id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  action text NOT NULL CHECK (action IN ('joined', 'left', 'added', 'removed', 'invitation_revoked')),
  actor_id uuid REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX chat_member_event_chat ON chat_member_event (chat_id, created_at);

CREATE TABLE message_draft (
  chat_id uuid NOT NULL REFERENCES chat(chat_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  content jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_draft_identity PRIMARY KEY (chat_id, principal_id)
);

-- Deferred FKs for space (509 sorts before the chat/folder/wiki tables exist).
ALTER TABLE space ADD CONSTRAINT space_chat_fk FOREIGN KEY (chat_id) REFERENCES chat(chat_id);
ALTER TABLE space ADD CONSTRAINT space_root_folder_fk FOREIGN KEY (root_folder_id) REFERENCES folder(folder_id);
ALTER TABLE space ADD CONSTRAINT space_wiki_space_fk FOREIGN KEY (wiki_space_id) REFERENCES wiki_space(wiki_space_id);
