/**
 * One resolution for the protected workspace PostgreSQL configuration the
 * WP-01/WP-48 database suites run against.
 *
 * The configuration file is local test infrastructure (never production
 * configuration) and is never embedded here: only its path is resolved, and
 * the file's own 0600/owner/no-symlink checks stay in
 * `loadProtectedWorkspaceDatabaseUrl`.
 *
 * Resolution order:
 *  1. `ROX_WORKSPACE_TEST_CONFIG` — the caller's explicit path. The repository
 *     test runner (`scripts/test-all.ts`) forwards it verbatim, so this is the
 *     deterministic way to point a run at a provisioned database.
 *  2. `ROX_TEST_HOST_HOME` — the caller's real home, which the runner exports
 *     because it gives every suite a private HOME. A bare `homedir()` fallback
 *     would otherwise resolve inside the suite's throwaway home and report the
 *     configuration as unavailable.
 *  3. This process's `homedir()` — a direct `bun test <file>` invocation,
 *     where HOME is already the caller's.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Absolute path of the protected configuration this process should load. */
export function protectedWorkspaceConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.ROX_WORKSPACE_TEST_CONFIG
    ?? join(environment.ROX_TEST_HOST_HOME || homedir(), '.agents/state/rox-compound-workspace/postgres-environment.json')
}
