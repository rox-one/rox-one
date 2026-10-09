/**
 * DreamNotesScanner — watermark semantics and the default Markdown scan.
 * Acceptance: content-hash watermark maps noteId → sha1(content); a changed
 * note is pending again; markProcessed is atomic and idempotent.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { createHash, randomUUID } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { basename, join, relative } from 'path'
import { getDefaultWorkspacesDir } from '@rox/shared/workspaces'
import { DreamNotesScanner, resolveDreamNotesRoot } from '../DreamNotesScanner'
import type { DreamNote } from '../DreamNotesScanner'

const roots: string[] = []
function mkroot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dream-notes-'))
  roots.push(root)
  return root
}
/** Workspace dirs created under the sandboxed default workspaces dir. */
const defaultWorkspaceDirs: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const dir of defaultWorkspaceDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const sha1 = (text: string): string => createHash('sha1').update(text, 'utf-8').digest('hex')

/**
 * The Notes RPC id derivation, copied verbatim from `notes.ts`
 * (`noteIdFromRelativePath` = POSIX-ify + strip a trailing `.md`). Comparing the
 * scanner's ids against this for the SAME files proves the dream's "ожидает сна"
 * ids intersect the ones the Notes screen emits.
 */
function notesRpcId(relativePath: string): string {
  const slashed = relativePath.replace(/\\/g, '/')
  return slashed.toLowerCase().endsWith('.md') ? slashed.slice(0, -3) : slashed
}
function notesRpcIds(root: string, files: string[]): string[] {
  return files.map((file) => notesRpcId(relative(root, file))).sort()
}
/** The Notes UI fallback root: `<defaultWorkspacesDir>/<workspaceId>/notes`. */
function defaultNotesRoot(workspaceId: string): string {
  return join(getDefaultWorkspacesDir(), workspaceId, 'notes')
}
function trackDefaultWorkspace(workspaceId: string): string {
  const dir = join(getDefaultWorkspacesDir(), workspaceId)
  defaultWorkspaceDirs.push(dir)
  return dir
}

describe('DreamNotesScanner', () => {
  it('returns notes whose hash differs from the watermark, then clears them', async () => {
    const root = mkroot()
    const stateFile = join(root, 'memory', 'notes-watermark.json')
    const notes: DreamNote[] = [
      { id: 'b.md', title: 'B', updatedAt: '2026-10-09T00:00:00Z', content: 'second' },
      { id: 'a.md', title: 'A', updatedAt: '2026-10-09T00:00:00Z', content: 'first' },
    ]
    const scanner = new DreamNotesScanner({ stateFile, listNotes: async () => notes })

    const pending = await scanner.listPending()
    expect(pending.map((n) => n.id)).toEqual(['a.md', 'b.md'])
    expect(pending[0].content).toBe('first')

    await scanner.markProcessed(['a.md'])
    const watermark = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, string>
    expect(watermark['a.md']).toBe(sha1('first'))

    expect((await scanner.listPending()).map((n) => n.id)).toEqual(['b.md'])

    // An edited note becomes pending again.
    notes[1].content = 'first-edited'
    expect((await scanner.listPending()).map((n) => n.id)).toEqual(['a.md', 'b.md'])
  })

  it('treats a corrupt watermark file as empty', async () => {
    const root = mkroot()
    const stateFile = join(root, 'notes-watermark.json')
    writeFileSync(stateFile, '{ not json')
    const scanner = new DreamNotesScanner({
      stateFile,
      listNotes: async () => [{ id: 'a.md', updatedAt: '2026-10-09T00:00:00Z', content: 'x' }],
    })
    expect((await scanner.listPending()).map((n) => n.id)).toEqual(['a.md'])
  })

  it('scans Markdown under the configured notes dir by default', async () => {
    const root = mkroot()
    const vault = join(root, 'vault')
    mkdirSync(join(vault, 'sub'), { recursive: true })
    writeFileSync(join(vault, 'note.md'), '# Заметка\n\nтело\n')
    writeFileSync(join(vault, 'sub', 'deep.md'), 'deep body\n')
    writeFileSync(join(vault, 'ignore.txt'), 'not markdown\n')

    const scanner = new DreamNotesScanner({ notesDir: vault, stateFile: join(root, 'wm.json') })
    const pending = await scanner.listPending()
    expect(pending.map((n) => n.id)).toEqual(['note', 'sub/deep'])
    expect(pending[0].title).toBe('Заметка')

    // The scanner emits the SAME id namespace as the Notes RPC: vault-relative
    // POSIX path with `.md` stripped (`noteIdFromRelativePath` in notes.ts /
    // vault-markdown.ts). Compare against the real derivation for these files.
    expect(pending.map((n) => n.id)).toEqual(
      notesRpcIds(vault, [join(vault, 'note.md'), join(vault, 'sub', 'deep.md')]),
    )

    await scanner.markProcessed(pending.map((n) => n.id))
    expect(await scanner.listPending()).toEqual([])
  })

  it('resolves the vault dir from {workspaceRoot}/sources/notes/config.json', async () => {
    const root = mkroot()
    const vault = join(root, 'my-notes')
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, 'a.md'), 'hello\n')
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true })
    writeFileSync(
      join(root, 'sources', 'notes', 'config.json'),
      JSON.stringify({ enabled: true, type: 'local', local: { path: '$WORKSPACE/my-notes' } }),
    )

    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    const pending = await scanner.listPending(root)
    expect(pending.map((n) => n.id)).toEqual(['a'])
  })

  it('expands a home-relative (~/...) vault path through the shared resolver', async () => {
    const root = mkroot()
    // Bun caches `os.homedir()` at process start, so `process.env.HOME` cannot
    // be redirected; create the vault under the real home and express it as `~`.
    const vault = mkdtempSync(join(homedir(), 'dream-notes-home-'))
    roots.push(vault)
    writeFileSync(join(vault, 'a.md'), 'hello\n')
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true })
    writeFileSync(
      join(root, 'sources', 'notes', 'config.json'),
      JSON.stringify({ enabled: true, type: 'local', local: { path: `~/${basename(vault)}` } }),
    )

    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    const pending = await scanner.listPending(root)
    expect(pending.map((n) => n.id)).toEqual(['a'])
  })

  it('accepts an absolute vault path', async () => {
    const root = mkroot()
    const vault = join(root, 'abs-vault')
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, 'n.md'), 'body\n')
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true })
    writeFileSync(
      join(root, 'sources', 'notes', 'config.json'),
      JSON.stringify({ enabled: true, type: 'local', local: { path: vault } }),
    )

    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    const pending = await scanner.listPending(root)
    expect(pending.map((n) => n.id)).toEqual(['n'])
  })

  it('returns nothing when no vault is reachable', async () => {
    const root = mkroot()
    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    expect(await scanner.listPending(root)).toEqual([])
    expect(await scanner.listPending()).toEqual([])
  })

  it('namespaces the watermark per bank so equal relative ids do not collide', async () => {
    const root = mkroot()
    const rootA = join(root, 'a')
    const rootB = join(root, 'b')
    mkdirSync(rootA, { recursive: true })
    mkdirSync(rootB, { recursive: true })
    writeFileSync(join(rootA, 'note.md'), 'alpha\n')
    writeFileSync(join(rootB, 'note.md'), 'beta\n')
    const stateFile = join(root, 'wm.json')
    const scanner = new DreamNotesScanner({ stateFile, resolveNotesRoot: (_id, workspaceRoot) => workspaceRoot })

    // Both banks see their own `note` pending, independently.
    const a = await scanner.listPending(rootA)
    const b = await scanner.listPending(rootB)
    expect(a.map((n) => n.id)).toEqual(['note'])
    expect(b.map((n) => n.id)).toEqual(['note'])
    expect(a[0].content).toBe('alpha\n')
    expect(b[0].content).toBe('beta\n')

    // Absorbing bank A's note must not touch bank B's identically-named one.
    await scanner.markProcessed(['note'], rootA)
    expect((await scanner.listPending(rootA)).map((n) => n.id)).toEqual([])
    expect((await scanner.listPending(rootB)).map((n) => n.id)).toEqual(['note'])

    // The two banks wrote distinct namespaced keys (old bare keys are ignored).
    const watermark = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, string>
    expect(watermark[`root:${rootA}::note`]).toBe(sha1('alpha\n'))
    expect(watermark[`root:${rootB}::note`]).toBeUndefined()

    await scanner.markProcessed(['note'], rootB)
    expect((await scanner.listPending(rootB)).map((n) => n.id)).toEqual([])
  })

  it('keeps markProcessed independent of a concurrent listing for another bank', async () => {
    const root = mkroot()
    const rootA = join(root, 'a')
    const rootB = join(root, 'b')
    mkdirSync(rootA, { recursive: true })
    mkdirSync(rootB, { recursive: true })
    writeFileSync(join(rootA, 'shared.md'), 'A body\n')
    writeFileSync(join(rootB, 'other.md'), 'B body\n')
    const stateFile = join(root, 'wm.json')
    const scanner = new DreamNotesScanner({ stateFile, resolveNotesRoot: (_id, workspaceRoot) => workspaceRoot })

    expect((await scanner.listPending(rootA)).map((n) => n.id)).toEqual(['shared'])
    // A concurrent read for another bank (e.g. the status channel) must not
    // evict bank A's listing.
    await scanner.listPending(rootB)

    await scanner.markProcessed(['shared'])
    const watermark = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, string>
    expect(watermark[`root:${rootA}::shared`]).toBe(sha1('A body\n'))
    expect((await scanner.listPending(rootA)).map((n) => n.id)).toEqual([])
    expect((await scanner.listPending(rootB)).map((n) => n.id)).toEqual(['other'])
  })

  it('ignores dot-dirs, templates, assets and import-provenanced paths like the Notes UI', async () => {
    const root = mkroot()
    const vault = join(root, 'vault')
    mkdirSync(join(vault, '.trash'), { recursive: true })
    mkdirSync(join(vault, 'templates'), { recursive: true })
    mkdirSync(join(vault, 'assets', 'imports'), { recursive: true })
    mkdirSync(join(vault, 'imports'), { recursive: true })
    writeFileSync(join(vault, 'real.md'), 'real body\n')
    writeFileSync(join(vault, '.trash', 'dead.md'), 'dead\n')
    writeFileSync(join(vault, 'templates', 't.md'), 'template\n')
    writeFileSync(join(vault, 'assets', 'imports', 'pic.md'), 'asset import\n')
    writeFileSync(join(vault, 'imports', 'alpha.md'), 'import\n')

    const scanner = new DreamNotesScanner({ notesDir: vault, stateFile: join(root, 'wm.json') })
    expect((await scanner.listPending()).map((n) => n.id)).toEqual(['real'])
  })

  it('listByIds returns unchanged notes by content, bypassing the watermark', async () => {
    const root = mkroot()
    const vault = join(root, 'vault')
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, 'a.md'), '# A\n\na body\n')
    writeFileSync(join(vault, 'b.md'), 'b body\n')
    const scanner = new DreamNotesScanner({ notesDir: vault, stateFile: join(root, 'wm.json') })

    // Absorb everything so nothing is pending…
    await scanner.markProcessed(['a', 'b'])
    expect(await scanner.listPending()).toEqual([])

    // …yet a forced run still gets its note's content.
    const forced = await scanner.listByIds(['a', 'missing', 'a'])
    expect(forced.map((n) => n.id)).toEqual(['a'])
    expect(forced[0].content).toBe('# A\n\na body\n')
  })
})

describe('DreamNotesScanner — Notes UI root consistency', () => {
  it('reads the custom workspace notesPath the Notes screen shows, not the source vault', async () => {
    const root = mkroot()
    const workspaceId = randomUUID()
    const custom = join(root, 'custom-notes')
    mkdirSync(join(custom, 'sub'), { recursive: true })
    writeFileSync(join(custom, 'two.md'), '# Two\n\ntwo body\n')
    writeFileSync(join(custom, 'sub', 'one.md'), 'one body\n')
    writeFileSync(join(root, 'config.json'), JSON.stringify({ name: 'ws', notesPath: custom }))

    // A DIFFERENT knowledge-source vault is present and must be ignored: the
    // custom notesPath is exactly what the Notes UI lists.
    const sourceVault = join(root, 'source-vault')
    mkdirSync(sourceVault, { recursive: true })
    writeFileSync(join(sourceVault, 'vault-only.md'), 'should never be scanned\n')
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true })
    writeFileSync(
      join(root, 'sources', 'notes', 'config.json'),
      JSON.stringify({ enabled: true, type: 'local', local: { path: sourceVault } }),
    )

    expect(resolveDreamNotesRoot(workspaceId, root)).toBe(custom)
    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    const pending = await scanner.listPending(root, workspaceId)

    const files = [join(custom, 'sub', 'one.md'), join(custom, 'two.md')]
    expect(pending.map((n) => n.id)).toEqual(notesRpcIds(custom, files))
    expect(pending.map((n) => n.id)).toEqual(['sub/one', 'two'])
    expect(pending.some((n) => n.id === 'vault-only')).toBe(false)
  })

  it('stays on a configured notesPath that does not exist yet and never switches vaults', async () => {
    const root = mkroot()
    const workspaceId = randomUUID()
    const missing = join(root, 'custom-notes-not-created')
    writeFileSync(join(root, 'config.json'), JSON.stringify({ name: 'ws', notesPath: missing }))

    // A different knowledge-source vault exists; the Notes UI uses (and would
    // create) the custom path, so the dream must report nothing, not scan here.
    const sourceVault = join(root, 'source-vault')
    mkdirSync(sourceVault, { recursive: true })
    writeFileSync(join(sourceVault, 'vault-only.md'), 'should never be scanned\n')
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true })
    writeFileSync(
      join(root, 'sources', 'notes', 'config.json'),
      JSON.stringify({ enabled: true, type: 'local', local: { path: sourceVault } }),
    )

    expect(resolveDreamNotesRoot(workspaceId, root)).toBe(missing)
    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    expect(await scanner.listPending(root, workspaceId)).toEqual([])
  })

  it('falls back to {defaultWorkspacesDir}/<id>/notes when the workspace sets no notesPath', async () => {
    const root = mkroot()
    const workspaceId = randomUUID()
    writeFileSync(join(root, 'config.json'), JSON.stringify({ name: 'ws' }))

    const notesRoot = defaultNotesRoot(workspaceId)
    trackDefaultWorkspace(workspaceId)
    mkdirSync(join(notesRoot, 'sub'), { recursive: true })
    writeFileSync(join(notesRoot, 'b.md'), '# B\n\nb body\n')
    writeFileSync(join(notesRoot, 'sub', 'a.md'), 'a body\n')

    expect(resolveDreamNotesRoot(workspaceId, root)).toBe(notesRoot)
    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    const pending = await scanner.listPending(root, workspaceId)

    const files = [join(notesRoot, 'b.md'), join(notesRoot, 'sub', 'a.md')]
    expect(pending.map((n) => n.id)).toEqual(notesRpcIds(notesRoot, files))
    expect(pending.map((n) => n.id)).toEqual(['b', 'sub/a'])
  })

  it('uses the knowledge-source vault when the primary root is absent', async () => {
    const root = mkroot()
    const workspaceId = randomUUID() // no `{defaultWorkspacesDir}/<id>/notes`
    const vault = join(root, 'source-vault')
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, 'n.md'), 'body\n')
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true })
    writeFileSync(
      join(root, 'sources', 'notes', 'config.json'),
      JSON.stringify({ enabled: true, type: 'local', local: { path: '$WORKSPACE/source-vault' } }),
    )

    expect(resolveDreamNotesRoot(workspaceId, root)).toBe(vault)
    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    expect((await scanner.listPending(root, workspaceId)).map((n) => n.id)).toEqual(['n'])
  })

  it('returns null/empty when neither the primary nor the source vault exists', async () => {
    const root = mkroot()
    const workspaceId = randomUUID()
    writeFileSync(join(root, 'config.json'), JSON.stringify({ name: 'ws' }))

    expect(resolveDreamNotesRoot(workspaceId, root)).toBeNull()
    // The global `main` bank has no workspace id and no default root either.
    expect(resolveDreamNotesRoot(null, root)).toBeNull()
    const scanner = new DreamNotesScanner({ stateFile: join(root, 'wm.json') })
    expect(await scanner.listPending(root, workspaceId)).toEqual([])
  })

  it('passes the workspace id and root to an injected resolver', async () => {
    const root = mkroot()
    const vault = join(root, 'injected')
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, 'x.md'), 'injected body\n')

    const calls: Array<[string | null, string]> = []
    const scanner = new DreamNotesScanner({
      stateFile: join(root, 'wm.json'),
      resolveNotesRoot: (workspaceId, workspaceRoot) => {
        calls.push([workspaceId, workspaceRoot])
        return vault
      },
    })

    expect((await scanner.listPending(root, 'ws-1')).map((n) => n.id)).toEqual(['x'])
    expect(calls).toEqual([['ws-1', root]])
  })
})