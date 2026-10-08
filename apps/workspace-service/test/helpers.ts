/**
 * W1-10 (#1507) — shared helpers for workspace-service harness tests.
 *
 * All helpers redirect HOME / config dirs at OS temp dirs via `mkdtemp`
 * (never the real `~/rox`). Postgres resolves through the harness fixture:
 * `ROX_TEST_PG_URL` when set (probed; throws if it never answers), a
 * throwaway docker container only with `ROX_TEST_PG_DOCKER=1`, otherwise
 * skipped.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensurePostgres, type PostgresFixture } from '@rox/test-harness'

export function makeTempWorkspace(prefix = 'w1-10-ws-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function tempHomeEnv(): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'w1-10-home-'))
  return { ...process.env, HOME: home }
}

export async function pgOrSkip(): Promise<{ fixture: PostgresFixture; skip: (reason: string) => void }> {
  const fixture = await ensurePostgres()
  return {
    fixture,
    skip: (reason: string) => {
      if (fixture.status !== 'live') console.log(`SKIP: ${reason} (${fixture.reason ?? 'no database'})`)
    },
  }
}
