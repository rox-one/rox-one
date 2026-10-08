-- W1-05 (issue #1502) · 02-directory · file 502-directory.sql
-- DATA-MODEL §5.9, §12. Owner module: directory (contacts).
-- Sorts as 502-* so it applies after 48-license-audit.sql (see migrations/README.md).
-- Extensions used by the unified schema. They live ONCE per database in the shared
-- `public` schema (not the migration schema: the migrator locks search_path to the
-- migration schema, and CREATE EXTENSION ... IF NOT EXISTS would otherwise short-circuit
-- on later schemas while the types stay invisible there). All references below are
-- schema-qualified (public.citext, public.gin_trgm_ops, public.unaccent) for the same reason.
--
-- Preflight: this file runs on every first start of a new binary, so a database that
-- cannot satisfy the requirement must fail with an actionable message, not a raw
-- 'type "public.citext" does not exist' halfway through the startup transaction.
--   * installed in public           -> nothing to do (no privilege needed);
--   * installed in another schema   -> error: a DBA must move it to public;
--   * missing                       -> CREATE EXTENSION ... WITH SCHEMA public, which needs
--     CREATE on the database (all three are trusted extensions on PostgreSQL 13+) or a
--     superuser; if that fails -> error naming the privilege / DBA pre-install path.
-- See migrations/README.md "Extensions" and ../DEPLOYMENT.md.
DO $rox_extension_preflight$
DECLARE
  ext text;
  ext_schema name;
  failed_state text;
  failed_message text;
BEGIN
  FOREACH ext IN ARRAY ARRAY['citext', 'pg_trgm', 'unaccent'] LOOP
    SELECT n.nspname INTO ext_schema
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = ext;
    IF FOUND THEN
      IF ext_schema <> 'public' THEN
        RAISE EXCEPTION USING
          ERRCODE = 'object_not_in_prerequisite_state',
          MESSAGE = format('workspace migrations need PostgreSQL extension "%s" in schema "public", but it is installed in schema "%s"', ext, ext_schema),
          HINT = format('Ask a DBA to run ALTER EXTENSION %s SET SCHEMA public (the unified schema references public.* objects), then restart. See apps/workspace-service/DEPLOYMENT.md.', ext);
      END IF;
    ELSE
      BEGIN
        EXECUTE format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA public', ext);
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS failed_state = RETURNED_SQLSTATE, failed_message = MESSAGE_TEXT;
        RAISE EXCEPTION USING
          ERRCODE = failed_state,
          MESSAGE = format('workspace migrations need PostgreSQL extension "%s" in schema "public"; it is not installed and the service role could not create it: %s', ext, failed_message),
          HINT = 'Grant the service role CREATE on the database (citext, pg_trgm and unaccent are trusted extensions on PostgreSQL 13+), or have a DBA run CREATE EXTENSION citext, pg_trgm, unaccent WITH SCHEMA public before the first start. See apps/workspace-service/DEPLOYMENT.md.';
      END;
    END IF;
  END LOOP;
END
$rox_extension_preflight$;

-- principal.kind (extended table #1 of 4). v2 status/primary_email land in 513.
-- Existing rows stay valid via DEFAULT 'human'.
ALTER TABLE principal ADD COLUMN kind text NOT NULL DEFAULT 'human'
  CHECK (kind IN ('human', 'bot', 'guest', 'service'));
CREATE INDEX principal_kind_idx ON principal (kind) WHERE deleted_at IS NULL;

CREATE TABLE user_profile (
  principal_id uuid PRIMARY KEY REFERENCES principal(principal_id),
  workspace_id uuid REFERENCES workspace(workspace_id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  given_name text, family_name text,
  username public.citext UNIQUE,
  avatar_url text, locale text NOT NULL DEFAULT 'ru', time_zone text NOT NULL DEFAULT 'UTC',
  manager_id uuid REFERENCES principal(principal_id),
  title text,
  person_type text CHECK (person_type IN ('human', 'guest')),
  notification_prefs jsonb NOT NULL DEFAULT '{}',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX user_profile_workspace ON user_profile (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE department (
  department_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  parent_id uuid REFERENCES department(department_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX department_workspace ON department (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE department_member (
  department_id uuid NOT NULL REFERENCES department(department_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('head', 'member')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT department_member_identity PRIMARY KEY (department_id, principal_id)
);
CREATE INDEX department_member_principal ON department_member (principal_id);

CREATE TABLE contact_star (
  owner_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  starred_ref text NOT NULL CHECK (length(starred_ref) > 0),
  sort_key text NOT NULL DEFAULT 'm',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT contact_star_identity PRIMARY KEY (owner_principal_id, starred_ref)
);

CREATE TABLE external_contact (
  external_contact_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  emails text[] NOT NULL DEFAULT '{}',
  phones text[] NOT NULL DEFAULT '{}',
  company text,
  created_by uuid REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX external_contact_workspace ON external_contact (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE bot_app (
  bot_app_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  bot_principal_id uuid NOT NULL REFERENCES principal(principal_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, bot_principal_id)
);

CREATE TABLE contact_card (
  contact_card_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  owner_scope text NOT NULL CHECK (owner_scope IN ('workspace', 'personal')),
  owner_id uuid,
  kind text NOT NULL CHECK (kind IN ('person', 'company')),
  principal_id uuid REFERENCES principal(principal_id),
  company_card_id uuid REFERENCES contact_card(contact_card_id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  emails text[] NOT NULL DEFAULT '{}',
  phones text[] NOT NULL DEFAULT '{}',
  title text,
  notes jsonb,
  fields jsonb NOT NULL DEFAULT '{}',
  touches jsonb NOT NULL DEFAULT '[]',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX contact_card_workspace ON contact_card (workspace_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX contact_card_principal ON contact_card (principal_id) WHERE principal_id IS NOT NULL AND deleted_at IS NULL;
