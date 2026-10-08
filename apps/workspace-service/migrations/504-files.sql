-- W1-05 (issue #1502) · 04-files · file 504-files.sql
-- DATA-MODEL §5.2 (file_object), §5.15 (v2 ownership/size/storage/provenance/trash columns,
-- folded into this v1 file per §12: "+ file_object columns in 04-files"). Owner module: drive.
-- owner_drive_id REFERENCES drive(...) is added in 516-drive-quota.sql (drive sorts later).
CREATE TABLE file_object (
  file_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_drive_id uuid,
  folder_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sha256 bytea,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  storage_key text,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  source_ref text,
  trashed_at timestamptz,
  trashed_by uuid REFERENCES principal(principal_id),
  purge_after timestamptz,
  uploaded_by uuid REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CHECK ((trashed_at IS NULL) = (trashed_by IS NULL))
);
CREATE INDEX file_object_workspace ON file_object (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX file_object_owner_drive ON file_object (owner_drive_id) WHERE deleted_at IS NULL;
CREATE INDEX file_object_source ON file_object (source_ref) WHERE source_ref IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX file_object_trash ON file_object (purge_after) WHERE trashed_at IS NOT NULL;
