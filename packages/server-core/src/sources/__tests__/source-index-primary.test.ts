import { afterEach, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NativeSidecarClient } from '../../native/client.ts'
import {
  NativeSupervisor,
  resolveNativeBin,
  setNativeSidecarSupervisorForTests,
} from '../../native/supervisor.ts'
import {
  closeAllSourceIndexes,
  reindexWorkspaceSources,
  searchSourceIndex,
  statusWorkspaceSources,
} from '../source-index-facade.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../')
const bin = resolveNativeBin(repoRoot) ?? (existsSync(process.env.CRAFT_NATIVE_BIN ?? '')
  ? process.env.CRAFT_NATIVE_BIN!
  : null)

const ORIGINAL_ENV = {
  CRAFT_FEATURE_NATIVE_SIDECAR: process.env.CRAFT_FEATURE_NATIVE_SIDECAR,
  CRAFT_FEATURE_NATIVE_INDEX_PRIMARY: process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY,
}

const dirs: string[] = []

function restoreEnv(): void {
  if (ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_SIDECAR === undefined) delete process.env.CRAFT_FEATURE_NATIVE_SIDECAR
  else process.env.CRAFT_FEATURE_NATIVE_SIDECAR = ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_SIDECAR
  if (ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY === undefined) delete process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY
  else process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = ORIGINAL_ENV.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY
}

afterEach(() => {
  closeAllSourceIndexes()
  setNativeSidecarSupervisorForTests(null)
  restoreEnv()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function installClient(client: NativeSidecarClient): void {
  setNativeSidecarSupervisorForTests({
    getClient: () => client,
  } as unknown as NativeSupervisor)
}

describe('native source-index primary', () => {
  it('returns the sidecar reindex result when the primary flag is on', async () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1'
    process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = '1'
    const workspace = mkdtempSync(join(tmpdir(), 'src-idx-primary-'))
    dirs.push(workspace)
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'only.md'), 'tiny ts tree')

    const invoked: string[] = []
    installClient({
      registeredChannels: ['index:reindex'],
      close: async () => {},
      invoke: async <T,>(channel: string) => {
        invoked.push(channel)
        if (channel === 'index:reindex') {
          return {
            indexed: 2100,
            skipped: 0,
            truncated: false,
            dbPath: '/tmp/source-index.native.sqlite',
            fts: true,
          } as T
        }
        throw new Error(`unexpected ${channel}`)
      },
    })

    const re = await reindexWorkspaceSources(workspace, [{ slug: 'docs', path: folder }])
    expect(invoked).toEqual(['index:reindex'])
    expect(re.indexed).toBe(2100)
    expect(re.truncated).toBe(false)
    expect(re.dbPath).toContain('source-index.native.sqlite')
  })

  it('status uses native index:status when primary is on', async () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1'
    process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = '1'
    const workspace = mkdtempSync(join(tmpdir(), 'src-idx-status-'))
    dirs.push(workspace)

    installClient({
      registeredChannels: ['index:status'],
      close: async () => {},
      invoke: async <T,>(channel: string) => {
        if (channel === 'index:status') {
          return { dbPath: '/tmp/source-index.native.sqlite', fts: true, indexed: 2100 } as T
        }
        throw new Error(`unexpected ${channel}`)
      },
    })

    const st = await statusWorkspaceSources(workspace)
    expect(st.primary).toBe('native')
    expect(st.sidecarLive).toBe(true)
    expect(st.indexed).toBe(2100)
    expect(st.fts).toBe(true)
    expect(st.dbPath).toContain('source-index.native.sqlite')
  })

  it('status reports TypeScript primary when flags are off', async () => {
    delete process.env.CRAFT_FEATURE_NATIVE_SIDECAR
    delete process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY
    const workspace = mkdtempSync(join(tmpdir(), 'src-idx-status-ts-'))
    dirs.push(workspace)
    const st = await statusWorkspaceSources(workspace)
    expect(st.primary).toBe('ts')
    expect(st.sidecarLive).toBe(false)
    expect(st.indexed).toBe(0)
  })

  it('falls back to TypeScript when the sidecar invoke fails', async () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1'
    process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = '1'
    const workspace = mkdtempSync(join(tmpdir(), 'src-idx-primary-fb-'))
    dirs.push(workspace)
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'alpha.md'), 'The quick brown fox')

    installClient({
      registeredChannels: ['index:reindex'],
      close: async () => {},
      invoke: async () => {
        throw new Error('sidecar down')
      },
    })

    const re = await reindexWorkspaceSources(workspace, [{ slug: 'docs', path: folder }])
    expect(re.indexed).toBe(1)
    expect(re.truncated).toBe(false)
    const fox = await searchSourceIndex(workspace, 'fox', { limit: 5 })
    expect(fox.hits.some((h) => h.path.includes('alpha.md'))).toBe(true)
  })
})

describe.skipIf(!bin)('native source-index primary live', () => {
  let supervisor: NativeSupervisor | null = null

  afterEach(async () => {
    await supervisor?.stop()
    supervisor = null
  })

  it('indexes past the TypeScript 2000-file cap and finds the tail keyword', async () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1'
    process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = '1'
    const sockDir = mkdtempSync(join(tmpdir(), 'src-idx-primary-sock-'))
    dirs.push(sockDir)
    supervisor = new NativeSupervisor({
      enabled: true,
      resolveBin: () => bin,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      connectTimeoutMs: 8_000,
      cwd: repoRoot,
      socketPath: join(sockDir, 'n.sock'),
    })
    await supervisor.start()
    expect(supervisor.getClient()).not.toBeNull()
    setNativeSidecarSupervisorForTests(supervisor)

    const workspace = mkdtempSync(join(tmpdir(), 'src-idx-primary-live-'))
    dirs.push(workspace)
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })
    const n = 2100
    for (let i = 0; i < n; i++) {
      const bucket = join(folder, `b${Math.floor(i / 100)}`)
      mkdirSync(bucket, { recursive: true })
      const extra = i === n - 1 ? ' UNIQUE_NEEDLE_PAST_CAP' : ''
      writeFileSync(join(bucket, `f${i}.md`), `doc ${i} fox${extra}`)
    }

    const re = await reindexWorkspaceSources(workspace, [{ slug: 'docs', path: folder }])
    expect(re.indexed).toBe(2100)
    expect(re.truncated).toBe(false)
    expect(re.written).toBe(2100)
    expect(re.unchanged ?? 0).toBe(0)

    const again = await reindexWorkspaceSources(workspace, [{ slug: 'docs', path: folder }])
    expect(again.indexed).toBe(2100)
    expect(again.written).toBe(0)
    expect(again.unchanged).toBe(2100)

    const hit = await searchSourceIndex(workspace, 'UNIQUE_NEEDLE_PAST_CAP', { limit: 5 })
    expect(hit.hits.some((h) => h.path.includes('f2099.md'))).toBe(true)

    const probe = spawnSync(bin!, ['--index-status', workspace], { encoding: 'utf8' })
    expect(probe.status).toBe(0)
    const status = JSON.parse(probe.stdout) as { indexed: number; fts: boolean; dbPath: string }
    expect(status.indexed).toBe(2100)
    expect(status.fts).toBe(true)
    expect(status.dbPath).toContain('source-index.native.sqlite')
  })
})
