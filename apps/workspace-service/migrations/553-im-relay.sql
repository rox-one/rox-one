-- W1-15 (issue #2042, feat/team-calls) · relay bridge · file 553-im-relay.sql
-- docs/messenger/messenger-contract.md §v1.1. Owner module: messenger (im).
--
-- The relay bridge keeps its two bookkeeping tables in a dedicated `im`
-- schema so the mapping (rox userId ↔ relay pubkey) and the service-event
-- idempotency log are independent of the workspace-service search_path.
-- Additive only: new schema, new tables, new index.
--
-- The `im` schema is per DATABASE while the migrator's advisory lock is per
-- schema, so the preflight below mirrors 502-directory.sql: it takes a
-- database-wide transaction lock, then creates `im` if missing. A database
-- whose role cannot create a top-level schema must have a DBA pre-create it
-- (`CREATE SCHEMA im`), exactly like the trusted extensions in 502; the failure
-- is reported with an actionable hint instead of a raw "permission denied".
DO $rox_im_schema_preflight$
DECLARE
  failed_state text;
  failed_message text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(2042, 553);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'im') THEN
    BEGIN
      EXECUTE 'CREATE SCHEMA im';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS failed_state = RETURNED_SQLSTATE, failed_message = MESSAGE_TEXT;
      RAISE EXCEPTION USING
        ERRCODE = failed_state,
        MESSAGE = format('workspace migrations need schema "im" for the relay bridge; it is missing and the service role could not create it: %s', failed_message),
        HINT = 'Grant the service role CREATE on the database, or have a DBA run CREATE SCHEMA im before the first start. See apps/workspace-service/DEPLOYMENT.md.';
    END;
  END IF;
END
$rox_im_schema_preflight$;

-- Per-user relay identity. `user_id` is the rox account id (principal id);
-- `pubkey` is the 32-byte x-only Nostr key (64 lowercase hex).
CREATE TABLE IF NOT EXISTS im.im_identity (
  user_id uuid PRIMARY KEY,
  pubkey text NOT NULL UNIQUE CHECK (pubkey ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- One row per published service event; `(call_id, type)` is the idempotency
-- key so a repeat POST returns the same `event_id` instead of re-publishing.
CREATE TABLE IF NOT EXISTS im.im_service_event (
  call_id text NOT NULL,
  type text NOT NULL,
  event_id text NOT NULL,
  channel_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT im_service_event_identity UNIQUE (call_id, type)
);

-- Per-channel Лента fan-out / call-card listing.
CREATE INDEX IF NOT EXISTS im_service_event_channel ON im.im_service_event (channel_id);
