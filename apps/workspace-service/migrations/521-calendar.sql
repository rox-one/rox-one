-- W1-05 (issue #1502) · 21-calendar · file 521-calendar.sql
-- DATA-MODEL §5.10 (calendar adopted; + origin_ref), §12. Owner module: calendar.
-- External provider events resolve through adapters (authority='external') and are cached
-- in freebusy_cache only; calendar_event rows are workspace-native events.
-- Deferred FK from 517-collab.sql lands at the end of this file.
CREATE TABLE calendar (
  calendar_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  color text,
  time_zone text NOT NULL DEFAULT 'UTC',
  owner_type text NOT NULL DEFAULT 'workspace'
    CHECK (owner_type IN ('principal', 'space', 'channel', 'workspace')),
  owner_id uuid,
  provider text CHECK (provider IN ('native', 'google', 'outlook', 'caldav')),
  external_id text,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX calendar_workspace ON calendar (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE calendar_event (
  event_id uuid PRIMARY KEY,
  calendar_id uuid NOT NULL REFERENCES calendar(calendar_id),
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description jsonb,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'UTC',
  location text,
  origin_ref text,
  recurrence jsonb,
  transparency text NOT NULL DEFAULT 'opaque' CHECK (transparency IN ('opaque', 'free')),
  organiser_id uuid REFERENCES principal(principal_id),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CHECK (ends_at >= starts_at)
);
-- Calendar overlay + upcoming-event panels.
CREATE INDEX calendar_event_range ON calendar_event (calendar_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX calendar_event_workspace_range ON calendar_event (workspace_id, starts_at) WHERE deleted_at IS NULL;

CREATE TABLE event_attendee (
  event_id uuid NOT NULL REFERENCES calendar_event(event_id),
  principal_id uuid REFERENCES principal(principal_id),
  email public.citext,
  status text NOT NULL DEFAULT 'needs_action'
    CHECK (status IN ('needs_action', 'accepted', 'declined', 'tentative')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- One row per (event, person-or-email); expressions are index-only (no expression PK).
CREATE UNIQUE INDEX event_attendee_uniq ON event_attendee (event_id, COALESCE(principal_id::text, email::text));

CREATE TABLE room (
  room_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  location text,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE TABLE freebusy_cache (
  cache_key text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  payload jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX freebusy_cache_expiry ON freebusy_cache (expires_at);

-- Deferred FK from 517-collab.sql (calendar sorts later).
ALTER TABLE calendar_member ADD CONSTRAINT calendar_member_calendar_fk
  FOREIGN KEY (calendar_id) REFERENCES calendar(calendar_id);
