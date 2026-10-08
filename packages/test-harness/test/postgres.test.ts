/** W1-10 self-test: Postgres fixture (env URL probed, docker opt-in only, cleanup on failure). */
import { describe, expect, test } from 'bun:test'
import { ensurePostgres, parseDockerPort, resolvePostgresUrl, type DockerResult } from '../src/postgres.ts'

const ok = (stdout = ''): DockerResult => ({ exitCode: 0, stdout, stderr: '' })
const bad = (stderr = 'boom'): DockerResult => ({ exitCode: 1, stdout: '', stderr })
const fast = { sleep: async () => {}, readinessTimeoutMs: 0, pollIntervalMs: 0 }

function fakeDocker(script: (args: string[]) => DockerResult) {
  const calls: string[][] = []
  return { calls, docker: (args: string[]) => { calls.push(args); return script(args) } }
}

describe('postgres fixture', () => {
  test('ROX_TEST_PG_URL is honoured when set', () => {
    expect(resolvePostgresUrl({ ROX_TEST_PG_URL: 'postgres://x' } as NodeJS.ProcessEnv)).toBe('postgres://x')
    expect(resolvePostgresUrl({} as NodeJS.ProcessEnv)).toBeNull()
    expect(resolvePostgresUrl({ ROX_TEST_PG_URL: '  ' } as NodeJS.ProcessEnv)).toBeNull()
  })

  test('env URL is live only after SELECT 1 answers; docker is never touched', async () => {
    const { calls, docker } = fakeDocker(() => ok())
    let probes = 0
    const fx = await ensurePostgres({ ROX_TEST_PG_URL: 'postgres://x' } as NodeJS.ProcessEnv, {
      docker, sleep: async () => {}, readinessTimeoutMs: 10_000, pollIntervalMs: 0,
      probe: async () => (probes += 1) >= 3,
    })
    expect(fx).toMatchObject({ status: 'live', url: 'postgres://x' })
    expect(probes).toBe(3)
    expect(calls).toEqual([])
  })

  test('an env URL that never answers throws instead of skipping', async () => {
    await expect(ensurePostgres({ ROX_TEST_PG_URL: 'postgres://x' } as NodeJS.ProcessEnv, { ...fast, probe: async () => false }))
      .rejects.toThrow('ROX_TEST_PG_URL')
  })

  test('without URL or opt-in it skips and never runs docker (no pull on plain PR runs)', async () => {
    const { calls, docker } = fakeDocker(() => ok())
    const fx = await ensurePostgres({} as NodeJS.ProcessEnv, { ...fast, docker, probe: async () => true })
    expect(fx.status).toBe('skipped')
    expect(fx.reason).toContain('ROX_TEST_PG_DOCKER=1')
    expect(calls).toEqual([])
  })

  test('opt-in docker: Docker-picked loopback port, readiness probe, cleanup removes the container', async () => {
    const { calls, docker } = fakeDocker((args) => (args[0] === 'port' ? ok('127.0.0.1:49321\n') : ok('id\n')))
    let probed = ''
    const fx = await ensurePostgres({ ROX_TEST_PG_DOCKER: '1' } as NodeJS.ProcessEnv, {
      ...fast, docker, probe: async (url) => { probed = url; return true },
    })
    expect(fx.status).toBe('live')
    expect(fx.url).toBe(probed)
    expect(fx.url).toMatch(/^postgres:\/\/postgres:[0-9a-f]{24}@127\.0\.0\.1:49321\/postgres$/)
    const run = calls.find((c) => c[0] === 'run')!
    expect(run).toContain('127.0.0.1::5432')
    expect(run.join(' ')).not.toMatch(/\b55433\b/)
    const name = run[run.indexOf('--name') + 1]
    await fx.cleanup!()
    expect(calls.at(-1)).toEqual(['rm', '-f', name])
  })

  test('opt-in docker: a container that never becomes ready is removed and the fixture throws', async () => {
    const { calls, docker } = fakeDocker((args) => (args[0] === 'port' ? ok('127.0.0.1:49322') : ok()))
    await expect(ensurePostgres({ ROX_TEST_PG_DOCKER: '1' } as NodeJS.ProcessEnv, { ...fast, docker, probe: async () => false }))
      .rejects.toThrow('readiness')
    const name = calls.find((c) => c[0] === 'run')!.at(calls.find((c) => c[0] === 'run')!.indexOf('--name') + 1)
    expect(calls.some((c) => c[0] === 'rm' && c[2] === name)).toBe(true)
  })

  test('opt-in docker: a failed docker run still removes the named container', async () => {
    const { calls, docker } = fakeDocker((args) => (args[0] === 'run' ? bad('pull denied') : ok()))
    await expect(ensurePostgres({ ROX_TEST_PG_DOCKER: '1' } as NodeJS.ProcessEnv, { ...fast, docker, probe: async () => true }))
      .rejects.toThrow('pull denied')
    expect(calls.some((c) => c[0] === 'rm')).toBe(true)
  })

  test('opt-in docker without a daemon throws a clear error', async () => {
    const { docker } = fakeDocker(() => bad())
    await expect(ensurePostgres({ ROX_TEST_PG_DOCKER: '1' } as NodeJS.ProcessEnv, { ...fast, docker })).rejects.toThrow('docker')
  })

  test('parseDockerPort reads IPv4 / IPv6 mappings', () => {
    expect(parseDockerPort('127.0.0.1:49153\n')).toBe(49153)
    expect(parseDockerPort('[::1]:49154')).toBe(49154)
    expect(parseDockerPort('')).toBeNull()
  })

  const live = resolvePostgresUrl()
  test.skipIf(!live)('a real ROX_TEST_PG_URL answers through the default probe', async () => {
    const fx = await ensurePostgres(process.env, { readinessTimeoutMs: 10_000 })
    expect(fx.status).toBe('live')
  })
})
