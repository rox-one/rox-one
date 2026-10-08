/**
 * W1-10 (#1507) — Postgres fixture.
 *
 * Resolution order:
 * 1. `ROX_TEST_PG_URL` — used as is (CI provides it from a `services:
 *    postgres` container when a job needs a live DB). It is probed with
 *    `SELECT 1` until ready; a URL that never answers throws, because an
 *    explicit configuration that cannot work must not turn into a skip.
 * 2. `ROX_TEST_PG_DOCKER=1` — opt-in only: start a throwaway `postgres:16`
 *    via the `docker` CLI (no testcontainers dependency). The host port is
 *    picked by Docker (`-p 127.0.0.1::5432`, read back with `docker port`),
 *    so there are no fixed-port collisions. The fixture returns `live` only
 *    after `SELECT 1` succeeds, and removes the container (`docker rm -f`)
 *    on every failure path, on `cleanup()` and at process exit.
 * 3. Otherwise `skipped` — never pulls an image on a plain test run.
 */
import { randomBytes } from 'node:crypto'
import { SQL } from 'bun'

export interface PostgresFixture {
  status: 'live' | 'skipped'
  url?: string
  reason?: string
  /** Present when this fixture started the container; call it to stop it. */
  cleanup?: () => Promise<void>
}

export interface DockerResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Injection points for self-tests; the defaults talk to real Postgres / docker. */
export interface PostgresFixtureDeps {
  probe?: (url: string) => Promise<boolean>
  docker?: (args: string[]) => DockerResult
  sleep?: (ms: number) => Promise<void>
  /** How long to wait for `SELECT 1` before giving up (default 60 s). */
  readinessTimeoutMs?: number
  pollIntervalMs?: number
}

export const POSTGRES_IMAGE = 'postgres:16'
export const CONTAINER_LABEL = 'rox.test-harness=w1-10'

export function resolvePostgresUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.ROX_TEST_PG_URL
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  return null
}

export function dockerOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ROX_TEST_PG_DOCKER === '1'
}

async function defaultProbe(url: string): Promise<boolean> {
  let db: SQL | undefined
  try {
    db = new SQL(url, { max: 1, connectionTimeout: 3 })
    await db`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await db?.close().catch(() => {})
  }
}

function defaultDocker(args: string[]): DockerResult {
  try {
    const proc = Bun.spawnSync(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
    return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() }
  } catch (error) {
    return { exitCode: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

async function waitReady(url: string, probe: (url: string) => Promise<boolean>, deps: PostgresFixtureDeps): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + (deps.readinessTimeoutMs ?? 60_000)
  const interval = deps.pollIntervalMs ?? 500
  for (;;) {
    if (await probe(url)) return true
    if (Date.now() >= deadline) return false
    await sleep(interval)
  }
}

/** `127.0.0.1:49153` / `[::1]:49153` / `0.0.0.0:49153` → 49153. */
export function parseDockerPort(output: string): number | null {
  for (const line of output.split('\n')) {
    const m = /:(\d+)\s*$/.exec(line.trim())
    if (m) return Number(m[1])
  }
  return null
}

export async function ensurePostgres(env: NodeJS.ProcessEnv = process.env, deps: PostgresFixtureDeps = {}): Promise<PostgresFixture> {
  const probe = deps.probe ?? defaultProbe
  const fromEnv = resolvePostgresUrl(env)
  if (fromEnv) {
    if (!(await waitReady(fromEnv, probe, deps))) {
      throw new Error('ROX_TEST_PG_URL is set but Postgres did not answer SELECT 1 before the readiness timeout')
    }
    return { status: 'live', url: fromEnv, reason: 'ROX_TEST_PG_URL' }
  }

  if (!dockerOptIn(env)) {
    return {
      status: 'skipped',
      reason: 'ROX_TEST_PG_URL is not set (CI: services: postgres) and ROX_TEST_PG_DOCKER=1 was not requested',
    }
  }

  const docker = deps.docker ?? defaultDocker
  if (docker(['info']).exitCode !== 0) {
    throw new Error('ROX_TEST_PG_DOCKER=1 but the docker CLI/daemon is not available')
  }

  const name = `rox-w1-10-pg-${process.pid}-${randomBytes(4).toString('hex')}`
  const password = randomBytes(12).toString('hex')
  const remove = () => {
    docker(['rm', '-f', name])
  }
  const onExit = () => remove()
  process.once('exit', onExit)
  const fail = (message: string): never => {
    remove()
    process.removeListener('exit', onExit)
    throw new Error(message)
  }

  try {
    const run = docker([
      'run', '-d', '--rm', '--name', name, '--label', CONTAINER_LABEL,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-p', '127.0.0.1::5432', POSTGRES_IMAGE,
    ])
    if (run.exitCode !== 0) fail(`docker run ${POSTGRES_IMAGE} failed: ${run.stderr.trim().slice(0, 300)}`)
    const port = parseDockerPort(docker(['port', name, '5432/tcp']).stdout)
    if (!port) fail('could not read the mapped host port of the postgres container')
    const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`
    if (!(await waitReady(url, probe, deps))) fail('postgres container did not answer SELECT 1 before the readiness timeout')
    return {
      status: 'live',
      url,
      reason: `ephemeral ${POSTGRES_IMAGE} container ${name}`,
      cleanup: async () => {
        remove()
        process.removeListener('exit', onExit)
      },
    }
  } catch (error) {
    remove()
    process.removeListener('exit', onExit)
    throw error
  }
}
