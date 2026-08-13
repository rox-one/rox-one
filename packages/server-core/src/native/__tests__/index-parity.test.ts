import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  closeAllSourceIndexes,
  reindexWorkspaceSources,
  searchSourceIndex,
} from '../../sources/source-index-facade.ts'
import { NativeSupervisor, resolveNativeBin } from '../supervisor.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../')
const bin = resolveNativeBin(repoRoot) ?? (existsSync(process.env.CRAFT_NATIVE_BIN ?? '')
  ? process.env.CRAFT_NATIVE_BIN!
  : null)

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

describe.skipIf(!bin)('craft-index path-set parity', () => {
  const dirs: string[] = []
  let supervisor: NativeSupervisor | null = null

  afterEach(async () => {
    closeAllSourceIndexes()
    await supervisor?.stop()
    supervisor = null
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('matches TypeScript search paths for unique keywords', async () => {
    const sockDir = mkdtempSync(join(tmpdir(), 'craft-native-parity-'))
    dirs.push(sockDir)
    supervisor = new NativeSupervisor({
      enabled: true,
      resolveBin: () => bin,
      logger: silentLogger(),
      connectTimeoutMs: 8_000,
      cwd: repoRoot,
      socketPath: join(sockDir, 'n.sock'),
    })
    await supervisor.start()
    const client = supervisor.getClient()
    expect(client).not.toBeNull()

    const workspace = mkdtempSync(join(tmpdir(), 'native-parity-'))
    dirs.push(workspace)
    const folderA = join(workspace, 'src-a')
    const folderB = join(workspace, 'src-b')
    mkdirSync(folderA, { recursive: true })
    mkdirSync(folderB, { recursive: true })
    writeFileSync(join(folderA, 'alpha.md'), 'The quick brown fox jumps over craft agents')
    writeFileSync(join(folderB, 'beta.md'), 'SiYuan flashcards and plugins surface modes')
    const roots = [
      { slug: 'local-a', path: folderA },
      { slug: 'local-b', path: folderB },
    ]

    const ts = reindexWorkspaceSources(workspace, roots)
    expect(ts.indexed).toBe(2)
    const rust = await client!.invoke<{ indexed: number; truncated: boolean }>(
      'index:reindex',
      workspace,
      roots,
    )
    expect(rust.indexed).toBe(2)

    const tsFox = searchSourceIndex(workspace, 'fox', { limit: 5 })
    const rustFox = await client!.invoke<{ hits: Array<{ path: string }> }>(
      'index:search',
      workspace,
      'fox',
      { limit: 5 },
    )
    const tsPaths = tsFox.hits.map((h) => h.path).sort()
    const rustPaths = rustFox.hits.map((h) => h.path).sort()
    expect(rustPaths).toEqual(tsPaths)
    expect(tsPaths.some((p) => p.includes('local-a/alpha.md'))).toBe(true)
  })
})
