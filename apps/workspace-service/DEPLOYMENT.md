# Workspace service: deployment notes

Applies from the unified DDL (W1-05, #1502) on. Migration details:
[`migrations/README.md`](migrations/README.md).

## Before the first start of a binary that ships `502…552`

1. **Take a pre-upgrade snapshot of the database** (`pg_dump` or a provider
   snapshot). This snapshot is the **only** way back to an older binary; see
   "Rollback".
2. **Make sure the extensions are available.** Every start applies the full
   sorted migration set in one transaction. `502-directory.sql` needs `citext`,
   `pg_trgm` and `unaccent` **in schema `public`**. Either:
   - the service role (`ROX_WORKSPACE_DATABASE_URL` user) has `CREATE` on the
     database. These are trusted extensions on PostgreSQL 13+, so no superuser
     is needed and the migration installs them; **or**
   - a DBA pre-installs them once:
     ```sql
     CREATE EXTENSION IF NOT EXISTS citext   WITH SCHEMA public;
     CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA public;
     CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
     ```
   If an extension is already installed in another schema (common on managed
   Postgres, for example `extensions`), a DBA must move it:
   `ALTER EXTENSION citext SET SCHEMA public` (likewise for `pg_trgm` and
   `unaccent`).

   If neither condition holds, startup fails before any DDL is recorded. The
   error is `workspace migrations need PostgreSQL extension "<name>" in schema
   "public"…`, and it carries a hint. Fix the database and restart.
3. The service role also needs to own (or have `CREATE` on) its migration schema,
   as before.

## Rollback

- **Feature rollback:** disable the feature flags. The unified tables stay
  empty and unbound while their flags are off.
- **Binary rollback** after this binary has started once: **restore the
  pre-upgrade snapshot**. An older binary fails every start with
  `MIGRATION_HISTORY_MISSING`, because the recorded history contains files it
  does not ship. There is no down migration.
- **DDL corrections** ship as new `553+` migration files. Shipped files are
  checksum-locked (`MIGRATION_CHANGED`) and are never edited in place.
