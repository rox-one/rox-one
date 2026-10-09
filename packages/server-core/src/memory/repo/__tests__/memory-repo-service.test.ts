import { afterEach, describe, expect, test, vi } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitExec, type GitExec } from '@rox/shared/memory/git-exec'
import type { MemoryRepoBankInfo } from '@rox/shared/memory/repo'
import type { RepoSourceBundle, RepoSourceLesson } from '../MemoryRepoMaterializer'
import { MemoryRepoService, type MemoryRepoServiceDeps, type RepoMaterializeResult } from '../MemoryRepoService'
import type { RepoSourceProvider } from '../RepoSourceProvider'
import { listRepoFiles, readSnapshots } from '../snapshots'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const LESSONS: RepoSourceLesson[] = [
  {
    lessonKey: 'rule one',
    rule: 'Rule one',
    category: 'workflow',
    negative: false,
    pinned: false,
    disabled: false,
    tags: ['tag-a'],
    createdAt: '2026-09-01T00:00:00.000Z',
    source: { trigger: 'explicit', sessionId: 's1' },
  },
  {
    lessonKey: 'rule two',
    rule: 'Rule two',
    category: 'correction',
    negative: true,
    pinned: false,
    disabled: false,
    tags: [],
    createdAt: '2026-09-02T00:00:00.000Z',
    source: { trigger: 'distillation', proposalId: 'p1' },
  },
]

function bundleFor(scope: 'main' | 'workspace'): RepoSourceBundle {
  return {
    bankId: scope === 'main' ? 'main' : 'ws:w1',
    scope,
    ...(scope === 'workspace' ? { workspaceName: 'Work' } : {}),
    lessons: LESSONS,
    context: scope === 'workspace' ? '# Context\n' : null,
    preferences: scope === 'main' ? '# Prefs\n' : null,
    history: scope === 'workspace' ? [{ date: '2026-10-01', content: '# 2026-10-01\n' }] : [],
  }
}

class FakeProvider implements RepoSourceProvider {
  constructor(private readonly bundle: RepoSourceBundle) {}
  async listBanks(): Promise<MemoryRepoBankInfo[]> {
    return [{ id: this.bundle.bankId, scope: this.bundle.scope, label: this.bundle.bankId, repoPath: '', isMain: this.bundle.scope === 'main' }]
  }
  async loadBundle(bankId: string): Promise<RepoSourceBundle> {
    return { ...this.bundle, bankId }
  }
}

/** FakeProvider with a replaceable bundle so a test can simulate promotions/edits. */
class MutableProvider implements RepoSourceProvider {
  constructor(public bundle: RepoSourceBundle) {}
  async listBanks(): Promise<MemoryRepoBankInfo[]> {
    return [{ id: this.bundle.bankId, scope: this.bundle.scope, label: this.bundle.bankId, repoPath: '', isMain: this.bundle.scope === 'main' }]
  }
  async loadBundle(bankId: string): Promise<RepoSourceBundle> {
    return { ...this.bundle, bankId }
  }
}

const unavailableGit: GitExec = {
  available: async () => false,
  run: async () => ({ ok: false, stdout: '', stderr: 'git unavailable', code: null }),
}

function makeService(provider: RepoSourceProvider, overrides: Partial<MemoryRepoServiceDeps> = {}): MemoryRepoService {
  return new MemoryRepoService({
    configDir: overrides.configDir ?? tempDir('repo-config'),
    git: overrides.git ?? createGitExec(),
    provider,
    debounceMs: overrides.debounceMs ?? 15,
    ...(overrides.getConfig ? { getConfig: overrides.getConfig } : {}),
  })
}

function treeHashes(repoPath: string): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const path of listRepoFiles(repoPath)) hashes[path] = readFileSync(join(repoPath, ...path.split('/')), 'utf8')
  return hashes
}

/**
 * Simulate a batch killed AFTER its snapshot landed but BEFORE `writeMeta`:
 * `.meta.json` still records the pre-batch hashes (here: none), so the retry
 * re-detects every managed path as `changed` even though disk == render.
 */
function simulateKilledSnapshotBatch(repoPath: string): void {
  const metaPath = `${repoPath}.meta.json`
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
  meta.files = {}
  meta.uncommitted = {}
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')
}

/** `git --git-dir <repo>/.git-rox --work-tree <repo> <args>` → stdout. */
function memGit(repoPath: string, args: string[]): string {
  return execFileSync('git', ['--git-dir', join(repoPath, '.git-rox'), '--work-tree', repoPath, ...args], { encoding: 'utf8' })
}

/** CRC-32 (IEEE 802.3) table, built independently of the exporter's own. */
const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function zipCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = ZIP_CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  path: string
  data: Buffer
  /** CRC-32 recorded in the central directory and in the local file header. */
  centralCrc: number
  localCrc: number
  localOffset: number
}

/**
 * Minimal store-only ZIP reader: EOCD → central directory → local header.
 * Data is resolved through each entry's CENTRAL-DIRECTORY offset and read using
 * the LOCAL header's name/extra/size fields, so a wrong offset or a wrong
 * local-header size yields mismatched bytes/checksums instead of silently
 * producing plausible output. (`Bun.Archive` cannot read this Bun's ZIP output,
 * so the parse is done here.)
 */
function readStoredZip(bytes: Buffer): ZipEntry[] {
  const eocd = bytes.length - 22
  if (bytes.readUInt32LE(eocd) !== 0x06054b50) throw new Error('EOCD signature not found')
  const total = bytes.readUInt16LE(eocd + 10)
  let cursor = bytes.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < total; i++) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('central directory header signature not found')
    const centralCrc = bytes.readUInt32LE(cursor + 16)
    const nameLen = bytes.readUInt16LE(cursor + 28)
    const extraLen = bytes.readUInt16LE(cursor + 30)
    const commentLen = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const path = bytes.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    if (localOffset >= bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`local file header signature not found for ${path}`)
    }
    const localCrc = bytes.readUInt32LE(localOffset + 14)
    const size = bytes.readUInt32LE(localOffset + 18)
    const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28)
    entries.push({ path, centralCrc, localCrc, localOffset, data: bytes.subarray(dataStart, dataStart + size) })
    cursor += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

describe('MemoryRepoService', () => {
  test('determinism: unchanged sources write nothing and make no second commit', async () => {
    const provider = new FakeProvider(bundleFor('main'))
    const service = makeService(provider)
    const repoPath = service.repoPathFor('main', '')

    const first = await service.materialize('main', 'test')
    expect(first.committed).toBe(true)
    expect(first.files).toBeGreaterThan(0)
    const before = treeHashes(repoPath)
    expect(before['MEMORY.md']).toBeDefined()
    expect(before['PROFILE.md']).toBeDefined()

    const second = await service.materialize('main', 'test')
    expect(second.committed).toBe(false)
    expect(second.sha).toBeUndefined()
    expect(second.files).toBe(0)
    expect(treeHashes(repoPath)).toEqual(before)
    expect(await service.listCommits('main')).toHaveLength(1)
    await service.dispose()
  })

  test('one commit per batch under concurrent notifyMutation; empty status makes no commit', async () => {
    const provider = new FakeProvider(bundleFor('main'))
    const service = makeService(provider, { debounceMs: 20 })
    vi.useFakeTimers()
    try {
      service.notifyMutation({ scope: 'main' }, 'rpc')
      service.notifyMutation({ scope: 'main' }, 'rpc')
      service.notifyMutation({ scope: 'main' }, 'session')
      vi.advanceTimersByTime(50)
      // dispose awaits the debounced materialization the timer kicked off
      await service.dispose()
    } finally {
      vi.useRealTimers()
    }
    expect(await service.listCommits('main')).toHaveLength(1)

    // concurrent direct materializations serialize on the per-bank mutex
    await Promise.all([service.materialize('main', 'a'), service.materialize('main', 'b')])
    expect(await service.listCommits('main')).toHaveLength(1)
    await service.dispose()
  })

  test('human edit guard: never overwrites, copies to .conflicts and reports editedFiles', async () => {
    const provider = new FakeProvider(bundleFor('main'))
    const service = makeService(provider)
    const repoPath = service.repoPathFor('main', '')
    await service.materialize('main', 'test')

    const memoryPath = join(repoPath, 'MEMORY.md')
    const edited = `${readFileSync(memoryPath, 'utf8')}\nhuman edit\n`
    writeFileSync(memoryPath, edited)

    await service.materialize('main', 'test')
    expect(readFileSync(memoryPath, 'utf8')).toBe(edited)

    const status = await service.status('main')
    expect(status.editedFiles).toContain('MEMORY.md')
    const stamp = readdirSync(join(repoPath, '.conflicts')).sort().pop()!
    expect(existsSync(join(repoPath, '.conflicts', stamp, 'MEMORY.md'))).toBe(true)
    await service.dispose()
  })

  test('human edit guard: a later mutation still updates the other files and commits', async () => {
    const provider = new MutableProvider(bundleFor('workspace'))
    const service = makeService(provider)
    const repoPath = service.repoPathFor('ws:w1', '')
    await service.materialize('ws:w1', 'test')

    const lessonNodesBefore = (await service.tree('ws:w1')).filter((node) => node.type === 'file' && node.path.startsWith('lessons/'))
    const memoryBefore = readFileSync(join(repoPath, 'MEMORY.md'), 'utf8')

    const editedPath = lessonNodesBefore[0]!.path
    const abs = join(repoPath, ...editedPath.split('/'))
    const edited = `${readFileSync(abs, 'utf8')}\nhuman note\n`
    writeFileSync(abs, edited)

    // a further mutation: a brand-new lesson and a changed context
    provider.bundle = {
      ...provider.bundle,
      lessons: [
        ...LESSONS,
        {
          lessonKey: 'rule three',
          rule: 'Rule three',
          category: 'workflow',
          negative: false,
          pinned: false,
          disabled: false,
          tags: [],
          createdAt: '2026-09-03T00:00:00.000Z',
          source: { trigger: 'explicit' },
        },
      ],
      context: '# Context\nupdated context\n',
    }
    const second = await service.materialize('ws:w1', 'test')
    expect(second.committed).toBe(true)
    expect(second.files).toBeGreaterThan(0)

    // the other files did update and a new lesson file appeared...
    expect(readFileSync(join(repoPath, 'MEMORY.md'), 'utf8')).not.toBe(memoryBefore)
    expect(readFileSync(join(repoPath, 'MEMORY.md'), 'utf8')).toContain('updated context')
    const lessonNodesAfter = (await service.tree('ws:w1')).filter((node) => node.type === 'file' && node.path.startsWith('lessons/'))
    expect(lessonNodesAfter.length).toBe(lessonNodesBefore.length + 1)

    // ...while the edited file is byte-identical and reported as edited
    expect(readFileSync(abs, 'utf8')).toBe(edited)
    const status = await service.status('ws:w1')
    expect(status.editedFiles).toContain(editedPath)
    await service.dispose()
  })

  test('workspace bank materializes context/history but never PROFILE.md', async () => {
    const service = makeService(new FakeProvider(bundleFor('workspace')))
    await service.materialize('ws:w1', 'test')
    const tree = await service.tree('ws:w1')
    expect(tree.some((node) => node.path === 'PROFILE.md')).toBe(false)
    expect(tree.some((node) => node.path === 'MEMORY.md')).toBe(true)
    expect(tree.some((node) => node.path === 'history/2026-10-01.md')).toBe(true)
    const status = await service.status('ws:w1')
    expect(status.scope).toBe('workspace')
    expect(status.dream.intervalHours).toBe(4)
    await service.dispose()
  })

  test('no-git fallback: snapshots history, diff and status.mode', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')), { git: unavailableGit })
    const first = await service.materialize('main', 'test')
    expect(first.committed).toBe(true)
    expect(first.sha).toBeDefined()

    const status = await service.status('main')
    expect(status.mode).toBe('snapshots')
    expect(status.head?.sha).toBe(first.sha)

    const commits = await service.listCommits('main')
    expect(commits).toHaveLength(1)
    expect(commits[0]!.files.length).toBeGreaterThan(0)
    const diff = await service.commitDiff('main', commits[0]!.sha)
    expect(diff.some((file) => file.op === 'added')).toBe(true)

    const second = await service.materialize('main', 'test')
    expect(second.committed).toBe(false)
    expect(await service.listCommits('main')).toHaveLength(1)
    await service.dispose()
  })

  test('no-git fallback: a retried batch whose tree matches the last snapshot appends nothing', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')), { git: unavailableGit })
    const repoPath = service.repoPathFor('main', '')
    const first = await service.materialize('main', 'first')
    expect(first.committed).toBe(true)
    expect(readSnapshots(repoPath)).toHaveLength(1)
    const indexBefore = readFileSync(join(repoPath, '.snapshots', 'index.jsonl'), 'utf8')

    // A killed batch left the snapshot in place but never advanced `.meta.json`,
    // so the retry re-stages every managed path even though disk == render.
    simulateKilledSnapshotBatch(repoPath)

    const retry = await service.materialize('main', 'retry')
    // The batch re-staged paths (nothing to quarantine), yet produced no entry.
    expect(retry.files).toBeGreaterThan(0)
    expect(retry.committed).toBe(false)
    expect(retry.sha).toBeUndefined()
    expect(readSnapshots(repoPath)).toHaveLength(1)
    expect(readFileSync(join(repoPath, '.snapshots', 'index.jsonl'), 'utf8')).toBe(indexBefore)
    expect((await service.status('main')).head?.sha).toBe(first.sha)
    await service.dispose()
  })

  test('foreign tree: memory commits land only in .git-rox', async () => {
    const userRepo = tempDir('user-repo')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: userRepo })
    mkdirSync(join(userRepo, 'src'), { recursive: true })
    writeFileSync(join(userRepo, 'src', 'file.ts'), 'export {}\n')
    execFileSync('git', ['add', '-A'], { cwd: userRepo })
    execFileSync('git', ['commit', '-q', '-m', 'user commit'], { cwd: userRepo })

    const memRepoDir = join(userRepo, '.memory-repo')
    const service = makeService(new FakeProvider(bundleFor('main')), {
      getConfig: () => ({ dreamIntervalHours: 4, dreamNotes: true, repoDir: memRepoDir }),
    })
    const repoPath = service.repoPathFor('main', '')
    const result = await service.materialize('main', 'test')
    expect(result.committed).toBe(true)

    const userTop = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: userRepo, encoding: 'utf8' }).trim()
    expect(realpathSync(userTop)).not.toBe(realpathSync(repoPath))
    expect(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: userRepo, encoding: 'utf8' }).trim().endsWith('.memory-repo')).toBe(false)

    // the user's history has only their own commit; memory commits live in .git-rox
    const userLog = execFileSync('git', ['log', '--format=%s'], { cwd: userRepo, encoding: 'utf8' }).trim().split('\n')
    expect(userLog).toEqual(['user commit'])
    const memoryLog = execFileSync(
      'git',
      ['--git-dir', join(repoPath, '.git-rox'), '--work-tree', repoPath, 'log', '--format=%s'],
      { encoding: 'utf8' },
    ).trim().split('\n')
    expect(memoryLog).toHaveLength(1)
    expect(memoryLog[0]).toMatch(/^memory\(main\):/)

    const status = await service.status('main')
    expect(status.foreignTree).toBe(true)
    await service.dispose()
  })

  test('default repo location: materialize leaves the workspace git tree clean', async () => {
    const workspaceRoot = tempDir('ws-default')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: workspaceRoot })
    writeFileSync(join(workspaceRoot, 'keep.txt'), 'keep\n')
    execFileSync('git', ['add', '-A'], { cwd: workspaceRoot })
    execFileSync('git', ['commit', '-q', '-m', 'workspace commit'], { cwd: workspaceRoot })

    const service = makeService(new FakeProvider(bundleFor('main')))
    const repoPath = service.repoPathFor('main', '')
    // the default location lives under the config dir, outside the workspace
    expect(repoPath.startsWith(workspaceRoot)).toBe(false)

    const result = await service.materialize('main', 'test')
    expect(result.committed).toBe(true)

    const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: workspaceRoot, encoding: 'utf8' })
    expect(porcelain.trim()).toBe('')
    await service.dispose()
  })

  test('readFile/tree/export/graph expose the rendered tree', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')

    const file = await service.readFile('main', 'MEMORY.md')
    expect(file.content.length).toBeGreaterThan(0)
    expect(file.truncated).toBe(false)
    await expect(service.readFile('main', '../escape')).rejects.toThrow()

    const graph = await service.graph('main')
    expect(graph.nodes.some((node) => node.kind === 'lesson')).toBe(true)
    expect(graph.nodes.some((node) => node.kind === 'topic')).toBe(true)

    const zip = await service.exportZip('main')
    expect(zip.bytes).toBeGreaterThan(0)
    expect(existsSync(zip.path)).toBe(true)
    expect(statSync(zip.path).size).toBe(zip.bytes)
    expect(readFileSync(zip.path).subarray(0, 2).toString('latin1')).toBe('PK')
    await service.dispose()
  })

  test('R8-4: exportZip round-trips — entry names, bytes, local offsets and CRCs all verify', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')

    const zip = await service.exportZip('main')
    const bytes = readFileSync(zip.path)
    const entries = readStoredZip(bytes)

    // The archived entry-name set is exactly the rendered repo file set that
    // tree()/listRepoFiles expose — no bookkeeping (.git-rox/.snapshots/*.tmp).
    const treeFiles = (await service.tree('main'))
      .filter((node) => node.type === 'file')
      .map((node) => node.path)
      .sort()
    // Set equality (the writer and listRepoFiles use different collations).
    const entryNames = entries.map((entry) => entry.path).sort()
    expect(entryNames).toEqual(listRepoFiles(repoPath))
    expect(entryNames).toEqual(treeFiles)
    expect(entries.length).toBeGreaterThan(0)

    for (const entry of entries) {
      const onDisk = readFileSync(join(repoPath, ...entry.path.split('/')))
      // Bytes resolved through the central-directory offset equal the on-disk file…
      expect(entry.data.equals(onDisk)).toBe(true)
      // …and an independently recomputed CRC-32 matches the value stored in BOTH
      // the central directory and the local header (not just the PK signature),
      // so a wrong CRC or a wrong offset fails the test.
      const expected = zipCrc32(entry.data)
      expect(entry.centralCrc).toBe(expected)
      expect(entry.localCrc).toBe(expected)
    }
    await service.dispose()
  })

  test('F1: readFile refuses symlinks that escape the bank root', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')

    const outside = tempDir('outside-bank')
    writeFileSync(join(outside, 'secret.md'), 'SECRET\n')
    mkdirSync(join(outside, 'nested'), { recursive: true })
    writeFileSync(join(outside, 'nested', 'deep.md'), 'DEEP\n')

    // A file symlink planted inside the bank dir, and a directory symlink.
    symlinkSync(join(outside, 'secret.md'), join(repoPath, 'escape-link.md'))
    symlinkSync(outside, join(repoPath, 'escape-dir'))

    await expect(service.readFile('main', 'escape-link.md')).rejects.toThrow('invalid path: escape-link.md')
    await expect(service.readFile('main', 'escape-dir/secret.md')).rejects.toThrow('invalid path: escape-dir/secret.md')
    await expect(service.readFile('main', 'escape-dir/nested/deep.md')).rejects.toThrow('invalid path')

    // A normal rendered file is still served.
    const file = await service.readFile('main', 'MEMORY.md')
    expect(file.content.length).toBeGreaterThan(0)
    expect(file.truncated).toBe(false)
    await service.dispose()
  })

  test('F2: readFile refuses reserved bookkeeping paths', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')

    await expect(service.readFile('main', '.git-rox/config')).rejects.toThrow('invalid path: .git-rox/config')
    await expect(service.readFile('main', '.snapshots/index.jsonl')).rejects.toThrow('invalid path: .snapshots/index.jsonl')
    await expect(service.readFile('main', 'MEMORY.md.123.tmp')).rejects.toThrow('invalid path')

    // A legitimate rendered file is still served.
    const file = await service.readFile('main', 'MEMORY.md')
    expect(file.content.length).toBeGreaterThan(0)
    await service.dispose()
  })

  test('writeRepoFile refuses a symlinked directory escape', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')
    const outside = tempDir('outside-write')
    symlinkSync(outside, join(repoPath, 'escape-write-dir'))
    await expect(service.writeRepoFile('main', 'escape-write-dir/DREAMS.md', '# x\n')).rejects.toThrow('invalid path')
    expect(existsSync(join(outside, 'DREAMS.md'))).toBe(false)
    await service.dispose()
  })

  test('writeRepoFile stores auxiliary files without touching rendered ones', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')
    await service.writeRepoFile('main', 'DREAMS.md', '# Dreams\n')
    expect(readFileSync(join(repoPath, 'DREAMS.md'), 'utf8')).toBe('# Dreams\n')
    // subsequent materialize must not delete or rewrite DREAMS.md
    await service.materialize('main', 'test')
    expect(readFileSync(join(repoPath, 'DREAMS.md'), 'utf8')).toBe('# Dreams\n')
    await service.dispose()
  })

  test('R8-5: status().dirty tracks DREAMS.md by real git status; the next materialize commits it', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    const repoPath = service.repoPathFor('main', '')
    await service.materialize('main', 'test')

    // 1. A settled bank is clean: the work tree matches HEAD and info/exclude
    //    hides the internal bookkeeping from the real `git status --porcelain`.
    const before = await service.status('main')
    expect(before.mode).toBe('git')
    expect(before.dirty).toBe(false)
    expect(readFileSync(join(repoPath, '.git-rox', 'info', 'exclude'), 'utf8')).toBe(
      '.git-rox/\n.meta.json\n*.tmp\n.conflicts/\n.snapshots/\n',
    )

    // 2. A freshly written DREAMS.md is untracked and is NOT listed in
    //    info/exclude, so the real `git status --porcelain` path reports the
    //    bank dirty. This is the documented intermediate state (plan §0#4):
    //    DREAMS.md is deferred and joins the NEXT materialize — it is not
    //    committed on write.
    await service.writeRepoFile('main', 'DREAMS.md', '# Dreams\nlesson\n')
    const pending = await service.status('main')
    expect(pending.dirty).toBe(true)
    expect(memGit(repoPath, ['status', '--porcelain'])).toContain('DREAMS.md')

    // 3. The next materialize stages and commits the deferred auxiliary file.
    const second = await service.materialize('main', 'dream')
    expect(second.committed).toBe(true)
    expect((await service.listCommits('main', 1))[0]!.files.map((file) => file.path)).toContain('DREAMS.md')
    expect((await service.tree('main')).some((node) => node.type === 'file' && node.path === 'DREAMS.md')).toBe(true)
    expect((await service.status('main')).dirty).toBe(false)
    await service.dispose()
  })

  test('edited-set hook: one import-ready per distinct edit, silent repeat, re-arm after revert', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')
    const memoryPath = join(repoPath, 'MEMORY.md')
    const profilePath = join(repoPath, 'PROFILE.md')
    const originalMemory = readFileSync(memoryPath, 'utf8')
    const originalProfile = readFileSync(profilePath, 'utf8')

    const seen: Array<{ bankId: string; count: number }> = []
    service.onEditedFilesChanged((bankId, editedFiles) => seen.push({ bankId, count: editedFiles.length }))

    // (1) an out-of-band edit is detected by status() and emits exactly once, with the count.
    writeFileSync(memoryPath, `${originalMemory}\nhuman edit\n`)
    writeFileSync(profilePath, `${originalProfile}\nhuman edit\n`)
    const first = await service.status('main')
    expect(first.editedFiles).toEqual(['MEMORY.md', 'PROFILE.md'])
    expect(seen).toEqual([{ bankId: 'main', count: 2 }])

    // (2) an unchanged edited set never re-emits on every status poll.
    await service.status('main')
    await service.status('main')
    expect(seen).toHaveLength(1)

    // (3) reverting clears the set silently (no emit) and re-arms the signal.
    writeFileSync(memoryPath, originalMemory)
    writeFileSync(profilePath, originalProfile)
    const reverted = await service.status('main')
    expect(reverted.editedFiles).toEqual([])
    expect(seen).toHaveLength(1)

    writeFileSync(memoryPath, `${originalMemory}\nnew edit\n`)
    await service.status('main')
    expect(seen).toEqual([
      { bankId: 'main', count: 2 },
      { bankId: 'main', count: 1 },
    ])
    await service.dispose()
  })

  test('promotion/rollback notify materializes and commits the affected lesson', async () => {
    const provider = new MutableProvider({
      bankId: 'ws:w1',
      scope: 'workspace',
      workspaceName: 'Work',
      lessons: [],
      context: '# Context\n',
      preferences: null,
      history: [],
    })
    const configDir = tempDir('repo-config')
    const service = makeService(provider, { configDir, debounceMs: 10 })
    await service.materialize('ws:w1', 'initial')
    expect(await service.listCommits('ws:w1')).toHaveLength(1)

    // A promotion lands in the source stores; the provider now reflects the post-promotion set.
    const promoted: RepoSourceLesson = {
      lessonKey: 'always run tests',
      rule: 'Always run tests',
      category: 'workflow',
      negative: false,
      pinned: false,
      disabled: false,
      tags: [],
      createdAt: '2026-10-09T00:00:00.000Z',
      source: { trigger: 'explicit', proposalId: 'p_promo' },
    }
    provider.bundle = { ...provider.bundle, lessons: [promoted] }

    vi.useFakeTimers()
    try {
      service.notifyMutation({ scope: 'workspace', workspaceId: 'w1' }, 'promotion')
      vi.advanceTimersByTime(50)
      await service.dispose()
    } finally {
      vi.useRealTimers()
    }

    const afterPromotion = await service.listCommits('ws:w1')
    expect(afterPromotion).toHaveLength(2)
    expect(afterPromotion[0]!.message).toContain('promotion')
    const promotionDiff = (await service.commitDiff('ws:w1', afterPromotion[0]!.sha)).filter((file) => file.path.startsWith('lessons/'))
    expect(promotionDiff).toHaveLength(1)
    expect(promotionDiff[0]!.op).toBe('added')

    // Rollback: the provider reflects the reverted (empty) lesson set.
    provider.bundle = { ...provider.bundle, lessons: [] }
    const rolledBack = makeService(provider, { configDir, debounceMs: 10 })
    vi.useFakeTimers()
    try {
      rolledBack.notifyMutation({ scope: 'workspace', workspaceId: 'w1' }, 'rollback')
      vi.advanceTimersByTime(50)
      await rolledBack.dispose()
    } finally {
      vi.useRealTimers()
    }

    const afterRollback = await service.listCommits('ws:w1')
    expect(afterRollback).toHaveLength(3)
    expect(afterRollback[0]!.message).toContain('rollback')
    const rollbackDiff = (await service.commitDiff('ws:w1', afterRollback[0]!.sha)).filter((file) => file.path.startsWith('lessons/'))
    expect(rollbackDiff).toHaveLength(1)
    expect(rollbackDiff[0]!.op).toBe('deleted')
  })

  test('status reports the edited backlog as pendingImportCount (D1)', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')
    expect((await service.status('main')).pendingImportCount).toBe(0)

    const memoryPath = join(repoPath, 'MEMORY.md')
    writeFileSync(memoryPath, `${readFileSync(memoryPath, 'utf8')}\nhuman edit\n`)
    const status = await service.status('main')
    expect(status.editedFiles).toEqual(['MEMORY.md'])
    expect(status.pendingImportCount).toBe(1)
    await service.dispose()
  })

  test('onMaterialized fires once per settled batch, including a no-op batch (D4)', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    const seen: Array<{ bankId: string; committed: boolean; files: number; reason: string }> = []
    service.onMaterialized((bankId, result, reason) => seen.push({ bankId, committed: result.committed, files: result.files, reason }))
    // a throwing listener is advisory and must never break materialize
    service.onMaterialized(() => {
      throw new Error('boom')
    })

    const first = await service.materialize('main', 'first')
    expect(first.committed).toBe(true)
    const noop = await service.materialize('main', 'noop')
    expect(noop.committed).toBe(false)
    expect(seen).toEqual([
      { bankId: 'main', committed: true, files: expect.any(Number), reason: 'first' },
      { bankId: 'main', committed: false, files: 0, reason: 'noop' },
    ])
    expect(seen[0]!.files).toBeGreaterThan(0)

    // unsubscribe stops delivery
    const off = service.onMaterialized(() => {
      throw new Error('unsubscribed listener must not run')
    })
    off()
    await service.materialize('main', 'third')
    expect(seen).toHaveLength(3)
    await service.dispose()
  })

  test('ensureMaterialized is lazy and materializes an owner-scoped bank on demand (D6)', async () => {
    const service = makeService(new FakeProvider(bundleFor('workspace')))
    const result = await service.ensureMaterialized('ws:w1#deadbeef')
    expect(result?.committed).toBe(true)
    expect(await service.listCommits('ws:w1#deadbeef')).toHaveLength(1)
    const tree = await service.tree('ws:w1#deadbeef')
    expect(tree.some((node) => node.type === 'file' && node.path.startsWith('lessons/'))).toBe(true)

    // The projection now exists — no second materialization, no second commit.
    expect(await service.ensureMaterialized('ws:w1#deadbeef')).toBeNull()
    expect(await service.listCommits('ws:w1#deadbeef')).toHaveLength(1)
    await service.dispose()
  })

  test('S1: padded and `#local` spellings of one bank share a repo path and a single mutex', async () => {
    const provider = new FakeProvider(bundleFor('main'))
    const real = createGitExec()
    const inFlight = { current: 0, max: 0 }
    const recordingGit: GitExec = {
      available: () => real.available(),
      async run(args, opts) {
        inFlight.current += 1
        inFlight.max = Math.max(inFlight.max, inFlight.current)
        try {
          // Yield once: a concurrently locked materialize would enter here.
          await Promise.resolve()
          return await real.run(args, opts)
        } finally {
          inFlight.current -= 1
        }
      },
    }
    const service = makeService(provider, { git: recordingGit })

    // Canonicalization makes every spelling address one repository directory.
    expect(service.repoPathFor('  main  ', '')).toBe(service.repoPathFor('main#local', ''))

    // Three spellings of ONE bank serialize on the same mutex: no git call overlaps.
    const results = await Promise.all([
      service.materialize('main', 'a'),
      service.materialize('  main  ', 'b'),
      service.materialize('main#local', 'c'),
    ])
    expect(inFlight.max).toBe(1)
    expect(results.filter((result) => result.committed)).toHaveLength(1)
    expect(await service.listCommits('main')).toHaveLength(1)
    await service.dispose()
  }, 30_000)

  test('S4: a non-positive/non-integer limit never reaches git as -nNaN and silently empties history', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    // Pre-fix `-nNaN` made git fail → []. Each invalid value now falls back to the default page.
    expect(await service.listCommits('main', Number.NaN)).toHaveLength(1)
    expect(await service.listCommits('main', -5)).toHaveLength(1)
    expect(await service.listCommits('main', 0)).toHaveLength(1)
    expect(await service.listCommits('main', 1.5)).toHaveLength(1)
    expect(await service.listCommits('main', '7' as unknown as number)).toHaveLength(1)
    expect(await service.listCommits('main', 10_000)).toHaveLength(1)
    await service.dispose()
  })

  test('S5: an already-emitted edited set is never re-emitted (a stale snapshot cannot rewind it)', async () => {
    const service = makeService(new FakeProvider(bundleFor('main')))
    await service.materialize('main', 'test')
    const repoPath = service.repoPathFor('main', '')
    const memoryPath = join(repoPath, 'MEMORY.md')
    const profilePath = join(repoPath, 'PROFILE.md')
    const originalMemory = readFileSync(memoryPath, 'utf8')

    const seen: number[] = []
    service.onEditedFilesChanged((_bankId, editedFiles) => seen.push(editedFiles.length))

    // (1) a realized edit emits once.
    const edit = `${originalMemory}\nhuman edit\n`
    writeFileSync(memoryPath, edit)
    expect((await service.status('main')).editedFiles).toEqual(['MEMORY.md'])
    expect(seen).toEqual([1])

    // (2) reverting emits nothing and does not re-arm the SAME key: a stale
    // snapshot that replays `['MEMORY.md']` is suppressed.
    writeFileSync(memoryPath, originalMemory)
    expect((await service.status('main')).editedFiles).toEqual([])
    writeFileSync(memoryPath, edit)
    expect((await service.status('main')).editedFiles).toEqual(['MEMORY.md'])
    expect(seen).toEqual([1])

    // (3) a genuinely different set is the only thing that re-arms the signal.
    writeFileSync(profilePath, `${readFileSync(profilePath, 'utf8')}\nhuman edit\n`)
    expect((await service.status('main')).editedFiles).toEqual(['MEMORY.md', 'PROFILE.md'])
    expect(seen).toEqual([1, 2])
    await service.dispose()
  })

  test('S3: a failed batch never quarantines its own bytes on retry after the render changed', async () => {
    const provider = new MutableProvider(bundleFor('workspace'))
    const real = createGitExec()
    let addFailures = 0
    const flakyGit: GitExec = {
      available: () => real.available(),
      async run(args, opts) {
        if (args[0] === 'add' && addFailures > 0) {
          addFailures -= 1
          return { ok: false, stdout: '', stderr: 'injected add failure', code: 1 }
        }
        return real.run(args, opts)
      },
    }
    const service = makeService(provider, { git: flakyGit })
    const repoPath = service.repoPathFor('ws:w1', '')

    provider.bundle = { ...provider.bundle, context: '# Context\nB\n' }
    expect((await service.materialize('ws:w1', 'first')).committed).toBe(true)

    // The batch writes C to disk, then `git add` fails → recorded hashes roll back.
    addFailures = 1
    provider.bundle = { ...provider.bundle, context: '# Context\nC\n' }
    const failed = await service.materialize('ws:w1', 'failed-add')
    expect(failed.committed).toBe(false)
    expect(readFileSync(join(repoPath, 'MEMORY.md'), 'utf8')).toContain('C')

    // The render changes BEFORE the retry: our abandoned C bytes must be treated
    // as ours (overwritten + staged), never as a human edit.
    provider.bundle = { ...provider.bundle, context: '# Context\nD\n' }
    const retry = await service.materialize('ws:w1', 'retry')
    expect(retry.committed).toBe(true)
    expect(readFileSync(join(repoPath, 'MEMORY.md'), 'utf8')).toContain('D')
    const status = await service.status('ws:w1')
    expect(status.editedFiles).toEqual([])
    expect(existsSync(join(repoPath, '.conflicts'))).toBe(false)
    await service.dispose()
  }, 30_000)

  test('F1: the uncommitted marker is durable before staging (write-ahead pre-seed)', async () => {
    const provider = new MutableProvider(bundleFor('workspace'))
    const real = createGitExec()
    const captured: Array<{ paths: string[]; uncommitted: Record<string, string>; disk: Record<string, string> }> = []
    let commitFailures = 0
    const probeGit: GitExec = {
      available: () => real.available(),
      async run(args, opts) {
        if (args[0] === 'add' && args[1] === '-A') {
          const meta = JSON.parse(readFileSync(`${opts.cwd}.meta.json`, 'utf8')) as { uncommitted?: Record<string, string> }
          const paths = args.slice(3)
          const disk: Record<string, string> = {}
          for (const path of paths) disk[path] = createHash('sha1').update(readFileSync(join(opts.cwd, ...path.split('/')))).digest('hex')
          captured.push({ paths, uncommitted: meta.uncommitted ?? {}, disk })
        }
        if (args[0] === 'commit' && commitFailures > 0) {
          commitFailures -= 1
          return { ok: false, stdout: '', stderr: 'injected commit failure', code: 1 }
        }
        return real.run(args, opts)
      },
    }
    const service = makeService(provider, { git: probeGit })
    const repoPath = service.repoPathFor('ws:w1', '')

    provider.bundle = { ...provider.bundle, context: '# Context\nA\n' }
    expect((await service.materialize('ws:w1', 'first')).committed).toBe(true)

    // At `git add -A` time every staged path already carries its write-ahead
    // marker (sha1 of the bytes just written): the marker is durable BEFORE
    // staging, so a kill between the write and the commit cannot lose it.
    const firstAdd = captured.at(-1)!
    expect(firstAdd.paths.length).toBeGreaterThan(0)
    for (const path of firstAdd.paths) expect(firstAdd.uncommitted[path]).toBe(firstAdd.disk[path])

    // A kill AFTER staging: the commit fails, our bytes stay and `files` rolls back.
    commitFailures = 1
    provider.bundle = { ...provider.bundle, context: '# Context\nB\n' }
    const killed = await service.materialize('ws:w1', 'killed')
    expect(killed.committed).toBe(false)
    expect(readFileSync(join(repoPath, 'MEMORY.md'), 'utf8')).toContain('B')

    // The render changes before the retry: the abandoned bytes are OURS (re-staged),
    // never a human edit — no `.conflicts/` copy, nothing withheld.
    provider.bundle = { ...provider.bundle, context: '# Context\nC\n' }
    const retry = await service.materialize('ws:w1', 'retry')
    expect(retry.committed).toBe(true)
    expect(readFileSync(join(repoPath, 'MEMORY.md'), 'utf8')).toContain('C')
    expect((await service.status('ws:w1')).editedFiles).toEqual([])
    expect(existsSync(join(repoPath, '.conflicts'))).toBe(false)

    // Human-edit protection is intact: bytes that differ from the marker (and from
    // the recorded hash) take the human path and are never overwritten.
    const memoryPath = join(repoPath, 'MEMORY.md')
    const humanEdit = `${readFileSync(memoryPath, 'utf8')}\nhuman edit\n`
    writeFileSync(memoryPath, humanEdit)
    await service.materialize('ws:w1', 'human')
    expect(readFileSync(memoryPath, 'utf8')).toBe(humanEdit)
    expect((await service.status('ws:w1')).editedFiles).toEqual(['MEMORY.md'])
    expect(existsSync(join(repoPath, '.conflicts'))).toBe(true)
    await service.dispose()
  }, 30_000)

  test('F2: a staged orphan from a killed batch never rides into a later commit', async () => {
    const provider = new MutableProvider(bundleFor('workspace'))
    const service = makeService(provider)
    const repoPath = service.repoPathFor('ws:w1', '')
    await service.materialize('ws:w1', 'first')

    // A killed batch left an unrelated file staged in the index.
    writeFileSync(join(repoPath, 'stray.txt'), 'orphan\n')
    memGit(repoPath, ['add', '-A', '--', 'stray.txt'])
    expect(memGit(repoPath, ['diff', '--cached', '--name-only'])).toContain('stray.txt')

    // A later, unrelated batch with a different change set commits…
    provider.bundle = { ...provider.bundle, context: '# Context\nchanged\n' }
    expect((await service.materialize('ws:w1', 'second')).committed).toBe(true)

    // …and its commit lists ONLY the batch's paths — the orphan is not committed.
    const headFiles = memGit(repoPath, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').filter(Boolean)
    expect(headFiles).toContain('MEMORY.md')
    expect(headFiles).not.toContain('stray.txt')
    // The orphan survives on disk, merely unstaged/untracked.
    expect(existsSync(join(repoPath, 'stray.txt'))).toBe(true)
    expect(memGit(repoPath, ['diff', '--cached', '--name-only']).trim()).toBe('')
    await service.dispose()
  }, 30_000)

  test('F3: a failed commit surfaces an error; a genuinely empty batch stays silent', async () => {
    const provider = new MutableProvider(bundleFor('workspace'))
    const real = createGitExec()
    let commitFailures = 0
    const flakyGit: GitExec = {
      available: () => real.available(),
      async run(args, opts) {
        if (args[0] === 'commit' && commitFailures > 0) {
          commitFailures -= 1
          return { ok: false, stdout: '', stderr: 'injected commit failure', code: 1 }
        }
        return real.run(args, opts)
      },
    }
    const service = makeService(provider, { git: flakyGit })

    const first = await service.materialize('ws:w1', 'first')
    expect(first.committed).toBe(true)
    expect(first.error).toBeUndefined()

    // A genuinely unchanged batch is a silent no-op: no commit, no error.
    const noop = await service.materialize('ws:w1', 'noop')
    expect(noop.committed).toBe(false)
    expect(noop.error).toBeUndefined()

    // A failed commit is NOT a no-op: the result carries the failure signal.
    commitFailures = 1
    provider.bundle = { ...provider.bundle, context: '# Context\nB\n' }
    const failed = await service.materialize('ws:w1', 'failed')
    expect(failed.committed).toBe(false)
    expect(failed.error).toContain('injected commit failure')
    await service.dispose()
  }, 30_000)

  test('stale index lock: a >60s lock left by a killed run is quarantined and the batch retries to success', async () => {
    const provider = new MutableProvider(bundleFor('workspace'))
    const service = makeService(provider)
    const repoPath = service.repoPathFor('ws:w1', '')
    expect((await service.materialize('ws:w1', 'first')).committed).toBe(true)

    // A SIGKILLed run left its index lock behind; it is two minutes old, so it
    // cannot belong to a live git invocation.
    const lockPath = join(repoPath, '.git-rox', 'index.lock')
    writeFileSync(lockPath, '')
    const old = new Date(Date.now() - 120_000)
    utimesSync(lockPath, old, old)

    const warns: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warns.push(args)
    }
    let recovered: RepoMaterializeResult
    try {
      provider.bundle = { ...provider.bundle, context: '# Context\nB\n' }
      recovered = await service.materialize('ws:w1', 'after-kill')
    } finally {
      console.warn = originalWarn
    }

    // The quarantine + single retry lands the batch, with no error.
    expect(recovered.committed).toBe(true)
    expect(recovered.error).toBeUndefined()
    expect(recovered.recoveredLock).toBeDefined()
    expect(recovered.recoveredLock!.startsWith(`${lockPath}.stale-`)).toBe(true)
    // quarantined (renamed, bytes preserved), not deleted
    expect(existsSync(recovered.recoveredLock!)).toBe(true)
    expect(existsSync(lockPath)).toBe(false)
    expect(warns.some((args) => String(args[0]).includes('quarantined stale index lock'))).toBe(true)
    expect(await service.listCommits('ws:w1')).toHaveLength(2)
    await service.dispose()
  }, 30_000)

  test('fresh index lock: a live run\'s lock is never touched and stays an honest error', async () => {
    const provider = new MutableProvider(bundleFor('workspace'))
    const service = makeService(provider)
    const repoPath = service.repoPathFor('ws:w1', '')
    expect((await service.materialize('ws:w1', 'first')).committed).toBe(true)

    // mtime == now → a live git invocation owns this lock.
    const lockPath = join(repoPath, '.git-rox', 'index.lock')
    writeFileSync(lockPath, '')

    provider.bundle = { ...provider.bundle, context: '# Context\nB\n' }
    const failed = await service.materialize('ws:w1', 'fresh-lock')

    expect(failed.committed).toBe(false)
    expect(failed.error).toContain('index.lock')
    expect(failed.recoveredLock).toBeUndefined()
    // the lock is left exactly where it was, and no quarantine copy was minted
    expect(existsSync(lockPath)).toBe(true)
    expect(readdirSync(join(repoPath, '.git-rox')).some((name) => name.startsWith('index.lock.stale-'))).toBe(false)
    await service.dispose()
  }, 30_000)

  test('status() on a settled git bank spawns exactly two git commands', async () => {
    const provider = new FakeProvider(bundleFor('main'))
    const real = createGitExec()
    const calls: string[][] = []
    const recordingGit: GitExec = {
      available: () => real.available(),
      async run(args, opts) {
        calls.push(args)
        return real.run(args, opts)
      },
    }
    const service = makeService(provider, { git: recordingGit })
    await service.materialize('main', 'test')
    calls.length = 0

    const status = await service.status('main')
    // No `rev-parse --show-toplevel` probes: the two remaining spawns are the
    // head log and the dirty `status --porcelain`.
    expect(status.mode).toBe('git')
    expect(status.foreignTree).toBe(false)
    expect(calls.map((args) => args[0])).toEqual(['log', 'status'])
    await service.dispose()
  }, 30_000)
})