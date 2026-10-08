-- W1-05 (issue #1502) · 16-drive-quota · file 516-drive-quota.sql
-- DATA-MODEL §5.15 (personal Drive 1 TiB, quota ledger), TECH-SPEC §16.3, §12.
-- Owner module: drive. Ledger + used_bytes updates are transactional in handlers;
-- the nightly reconciler repairs drift with audited `adjust` entries.
CREATE TABLE drive (
  drive_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  root_folder_id uuid NOT NULL REFERENCES folder(folder_id),
  quota_bytes bigint NOT NULL DEFAULT 1099511627776 CHECK (quota_bytes > 0),
  used_bytes bigint NOT NULL DEFAULT 0,
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  trash_bytes bigint NOT NULL DEFAULT 0 CHECK (trash_bytes >= 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'over_quota', 'frozen')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, owner_principal_id)
);

CREATE TABLE storage_ledger (
  entry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  drive_id uuid NOT NULL REFERENCES drive(drive_id),
  delta_bytes bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('upload', 'version', 'copy', 'artifact', 'recording', 'trash',
    'restore', 'purge', 'transfer_in', 'transfer_out', 'adjust')),
  file_id uuid REFERENCES file_object(file_id),
  version_no integer,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX storage_ledger_drive ON storage_ledger (drive_id, created_at);

CREATE TABLE file_version (
  file_id uuid NOT NULL REFERENCES file_object(file_id),
  version_no integer NOT NULL CHECK (version_no > 0),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 bytea NOT NULL,
  storage_key text NOT NULL CHECK (length(storage_key) > 0),
  content_type text NOT NULL,
  created_by uuid NOT NULL REFERENCES principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT file_version_identity PRIMARY KEY (file_id, version_no)
);

CREATE TABLE file_preview (
  file_id uuid NOT NULL,
  version_no integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('thumb_256', 'thumb_1024', 'pdf', 'text', 'poster')),
  storage_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'unsupported')),
  CONSTRAINT file_preview_identity PRIMARY KEY (file_id, version_no, kind),
  FOREIGN KEY (file_id, version_no) REFERENCES file_version(file_id, version_no)
);

CREATE TABLE upload_session (
  upload_session_id uuid PRIMARY KEY,
  drive_id uuid NOT NULL REFERENCES drive(drive_id),
  folder_id uuid REFERENCES folder(folder_id),
  file_name text NOT NULL CHECK (length(btrim(file_name)) > 0),
  size_expected bigint NOT NULL CHECK (size_expected >= 0),
  content_type text,
  s3_upload_id text,
  parts jsonb NOT NULL DEFAULT '[]',
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'aborted', 'expired')),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX upload_session_expiry ON upload_session (expires_at) WHERE status = 'open';

-- Deferred FK: file_object (504) sorts before drive exists.
ALTER TABLE file_object ADD CONSTRAINT file_object_owner_drive_fk
  FOREIGN KEY (owner_drive_id) REFERENCES drive(drive_id);
