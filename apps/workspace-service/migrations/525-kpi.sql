-- W1-05 (issue #1502) · 25-kpi · file 525-kpi.sql
-- DATA-MODEL §5.7, §12. Owner module: kpis.
CREATE TABLE kpi (
  kpi_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  space_id uuid NOT NULL,
  champion_id uuid REFERENCES principal(principal_id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  unit text NOT NULL DEFAULT '',
  cadence text NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  description jsonb,
  direction text NOT NULL DEFAULT 'increase',
  target_value double precision,
  next_entry_due_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX kpi_space ON kpi (space_id) WHERE deleted_at IS NULL;
CREATE INDEX kpi_entry_due ON kpi (next_entry_due_at) WHERE next_entry_due_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE kpi_entry (
  kpi_entry_id uuid PRIMARY KEY,
  kpi_id uuid NOT NULL REFERENCES kpi(kpi_id),
  recorded_by uuid NOT NULL REFERENCES principal(principal_id),
  value double precision NOT NULL,
  period date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (kpi_id, period)
);
CREATE INDEX kpi_entry_kpi ON kpi_entry (kpi_id, period DESC) WHERE deleted_at IS NULL;

CREATE TABLE kpi_entry_edit (
  kpi_entry_id uuid NOT NULL REFERENCES kpi_entry(kpi_entry_id),
  edited_by uuid REFERENCES principal(principal_id),
  previous_value double precision,
  previous_period date,
  edited_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX kpi_entry_edit_entry ON kpi_entry_edit (kpi_entry_id);

CREATE TABLE kpi_annotation (
  kpi_annotation_id uuid PRIMARY KEY,
  kpi_id uuid NOT NULL REFERENCES kpi(kpi_id),
  created_by uuid REFERENCES principal(principal_id),
  date date NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE INDEX kpi_annotation_kpi ON kpi_annotation (kpi_id, date) WHERE deleted_at IS NULL;
