-- W1-05 (issue #1502) · 07-search · file 507-search.sql
-- DATA-MODEL §11, §12. Owner module: search.
-- FTS configs: russian (title, weight A) + english (title, weight A) + simple (body, weight B),
-- with unaccent available for query-side normalisation. GIN on tsv, pg_trgm on title.
CREATE TABLE search_document (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  kind text NOT NULL CHECK (length(kind) > 0),
  ref_id text NOT NULL CHECK (length(ref_id) > 0),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  space_id uuid,
  project_id uuid,
  goal_id uuid,
  container_ref text,
  state text,
  acl_principals uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  tsv tsvector NOT NULL DEFAULT ''::tsvector,
  CONSTRAINT search_document_identity PRIMARY KEY (workspace_id, kind, ref_id)
);
CREATE INDEX search_document_tsv ON search_document USING gin (tsv);
CREATE INDEX search_document_title_trgm ON search_document USING gin (title public.gin_trgm_ops);
CREATE INDEX search_document_container ON search_document (workspace_id, space_id, project_id, goal_id);

CREATE FUNCTION search_document_refresh_tsv() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.tsv :=
    setweight(to_tsvector('russian', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.body, '')), 'B');
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER search_document_tsv_trigger BEFORE INSERT OR UPDATE OF title, body ON search_document
  FOR EACH ROW EXECUTE FUNCTION search_document_refresh_tsv();

-- "Frequently used" ranking for the Omnibox (DATA-MODEL §11, usage). Per workspace: ref is
-- free text and a principal can belong to several workspaces (README "Tenant scoping").
CREATE TABLE search_usage (
  workspace_id uuid NOT NULL REFERENCES workspace(workspace_id),
  principal_id uuid NOT NULL REFERENCES principal(principal_id),
  kind text NOT NULL CHECK (length(kind) > 0),
  ref text NOT NULL CHECK (length(ref) > 0),
  score double precision NOT NULL DEFAULT 0,
  last_used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT search_usage_identity PRIMARY KEY (workspace_id, principal_id, kind, ref)
);
CREATE INDEX search_usage_rank ON search_usage (workspace_id, principal_id, score DESC);
