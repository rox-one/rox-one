-- W1-05 (issue #1502) · 30-vc · file 530-vc.sql
-- DATA-MODEL §5.10 (meetings), §12. Owner module: meetings.
-- The meetings journal (local) stays the authority for Meeting state;
-- shared meetings publish a projection row through the outbox.
CREATE TABLE meeting_room (
  call_id uuid PRIMARY KEY,
  workspace_id uuid REFERENCES workspace(workspace_id),
  livekit_room text,
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'live', 'ended')),
  started_at timestamptz,
  ended_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- LiveKit Egress output; charged to the organiser's drive (TECH-SPEC §16.5).
CREATE TABLE recording (
  call_id uuid PRIMARY KEY REFERENCES meeting_room(call_id),
  file_id uuid REFERENCES file_object(file_id),
  consent jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
