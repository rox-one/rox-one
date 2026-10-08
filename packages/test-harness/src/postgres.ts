/**
 * W1-10 (#1507) — Postgres fixture.
 *
 * Prefers `ROX_TEST_PG_URL` when set. Otherwise tries to start an ephemeral
 * `postgres:16` container via the `docker` CLI directly (no testcontainers
 * dependency — see the W1-10 package card). When neither is available the
 * fixture reports `skipped` so CI stays green; gates must never fail on a
 * missing database, only on real violations.
 */

export interface PostgresFixture {
  status: 'live' | 'skipped'
  url?: string
  reason?: string
  /** Present when this fixture started the container; call it to stop it. */
  cleanup?: () => Promise<void>
}

export function resolvePostgresUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.ROX_TEST_PG_URL
  if (typeof raw === 'string' && raw.length > 0) return raw
  return null
}

async function dockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' })
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function ensurePostgres(env: NodeJS.ProcessEnv = process.env): Promise<PostgresFixture> {
  const fromEnv = resolvePostgresUrl(env)
  if (fromEnv) return { status: 'live', url: fromEnv }

  if (!(await dockerAvailable())) {
    return { status: 'skipped', reason: 'ROX_TEST_PG_URL is not set and no docker CLI is available' }
  }

  const name = `rox-w1-10-pg-${process.pid}`
  const password = 'rox-test'
  const port = '55433'
  const start = Bun.spawnSync(
    [
      'docker', 'run', '-d', '--rm', '--name', name,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-p', `${port}:5432`, 'postgres:16',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  if (start.exitCode !== 0) {
    return { status: 'skipped', reason: 'docker run postgres:16 failed' }
  }
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`
  return {
    status: 'live',
    url,
    reason: 'ephemeral postgres:16 container',
    cleanup: async () => {
      Bun.spawnSync(['docker', 'rm', '-f', name], { stdout: 'ignore', stderr: 'ignore' })
    },
  }
}
