/**
 * Legacy local Notes provider — wikilink auto-create (`autoCreateLinkedNotes`).
 *
 * A legacy SAVE must materialise one note per new, safe wikilink target and
 * report the created ids as `autoCreatedNoteIds`. Unsafe targets (protected
 * folders, hidden/dotted segments, traversal, reserved characters, malformed
 * wikilinks) are ignored; a mid-run failure must roll back everything already
 * created and rethrow the offending target in the message. Concurrent saves of
 * the same target stay idempotent because target creation is `O_EXCL`.
 *
 * The harness drives the invoked RPC handlers the way the Electron host does:
 * the workspace registry is a module seam (`@rox/shared/config` is mocked so the
 * real module never leaks THIS directory's other suite's fixtures through bun's
 * process-global mock registry — mirrors sources.test.ts / native-content-integration.test.ts),
 * while Notes roots resolve through the real `@rox/shared/workspaces` against the
 * sandboxed `ROX_CONFIG_DIR`.
 */
import '../memory-test-setup' // must run before any module reading ROX_CONFIG_DIR
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS, type NoteDocument } from '@rox/shared/protocol'
import { getDefaultWorkspacesDir } from '@rox/shared/workspaces'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

let workspaceRoot: string

mock.module('@rox/shared/config', () => ({
  getWorkspaceByNameOrId: (nameOrId: string) =>
    nameOrId === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
  getWorkspaces: () => [{ id: 'ws1', name: 'ws1', rootPath: workspaceRoot }],
  isImportProvenancedRelativePath: () => false,
}))

import { registerNotesHandlers } from '../notes'

/** Legacy fallback root: `<defaultWorkspacesDir>/<workspaceId>/notes`. */
function notesRoot(): string {
  return join(getDefaultWorkspacesDir(), 'ws1', 'notes')
}

function noteContent(title: string, body: string, createdAt: number | string = 1_787_961_600_000): string {
  return `---\ntitle: ${title}\ntags: []\ncreatedAt: ${createdAt}\n---\n\n${body}`
}

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
    // Local Electron client: ownsWindow() must confirm this window/workspace.
    windowManager: {
      getWindowByWebContentsId: () => ({}),
      getWorkspaceForWindow: () => 'ws1',
    } as unknown as HandlerDeps['windowManager'],
  }
  registerNotesHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]): Promise<NoteDocument> => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: 'ws1', webContentsId: 1 } as unknown as RequestContext, ...args) as Promise<NoteDocument>
  }
  return { handlers, invoke }
}

/** Writes the source note to disk (as a prior editor save would) and reads it back for revision/source binding. */
async function seedSource(
  invoke: (channel: string, ...args: unknown[]) => Promise<NoteDocument>,
  noteId: string,
  content: string,
): Promise<NoteDocument> {
  mkdirSync(notesRoot(), { recursive: true })
  writeFileSync(join(notesRoot(), `${noteId}.md`), content, 'utf-8')
  return invoke(RPC_CHANNELS.notes.READ, 'ws1', noteId)
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'notes-autocreate-ws-'))
  rmSync(getDefaultWorkspacesDir(), { recursive: true, force: true })
})

describe('legacy Notes SAVE — wikilink auto-create', () => {
  it('creates one note per new target and stays idempotent across repeated saves', async () => {
    const { invoke } = createHarness()
    const content = noteContent('Source', 'See [[Linked Note]] and its explicit form [[Linked Note.md]].')
    const seed = await seedSource(invoke, 'Source', content)

    const first = await invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source', content, seed.revision, seed.sourceStoreId)
    expect(first.autoCreatedNoteIds).toEqual(['Linked Note'])

    const linkedPath = join(notesRoot(), 'Linked Note.md')
    expect(existsSync(linkedPath)).toBe(true)
    const linkedBytes = readFileSync(linkedPath, 'utf-8')

    // Re-read so the revision precondition reflects the committed bytes.
    const afterFirst = await invoke(RPC_CHANNELS.notes.READ, 'ws1', 'Source')
    const second = await invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source', content, afterFirst.revision, afterFirst.sourceStoreId)
    expect(second.autoCreatedNoteIds).toEqual([])

    expect(readFileSync(linkedPath, 'utf-8')).toBe(linkedBytes)
    expect(readdirSync(notesRoot()).filter((name) => name === 'Linked Note.md')).toHaveLength(1)
  })

  it('ignores protected, hidden, traversal, reserved-char, and malformed targets', async () => {
    const { invoke } = createHarness()
    const content = noteContent('Source', [
      'Good [[Good Note]].',
      'Protected [[assets/Leak]] and [[templates/Leak]].',
      'Hidden [[.private/Leak]].',
      'Traversal [[../Escape]].',
      'Newline [[Bad',
      'Target]].',
      'Nested [[Nested [[Bad]]]].',
      'Reserved char [[Bad:Target]].',
    ].join('\n'))
    const seed = await seedSource(invoke, 'Source', content)

    const saved = await invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source', content, seed.revision, seed.sourceStoreId)

    expect(saved.autoCreatedNoteIds).toEqual(['Good Note'])
    expect(existsSync(join(notesRoot(), 'Good Note.md'))).toBe(true)
    expect(existsSync(join(notesRoot(), 'assets', 'Leak.md'))).toBe(false)
    expect(existsSync(join(notesRoot(), 'templates', 'Leak.md'))).toBe(false)
    expect(existsSync(join(notesRoot(), '.private', 'Leak.md'))).toBe(false)
    expect(existsSync(join(getDefaultWorkspacesDir(), 'ws1', 'Escape.md'))).toBe(false)
  })

  it('names the wikilink that could not be auto-created', async () => {
    const { invoke } = createHarness()
    mkdirSync(notesRoot(), { recursive: true })
    const outsideDir = mkdtempSync(join(tmpdir(), 'notes-autocreate-outside-'))
    // A symlinked folder is not a legal notes directory; escape must fail closed.
    symlinkSync(outsideDir, join(notesRoot(), 'Linked'))
    try {
      const content = noteContent('Source', 'Create [[First Target]], then fail [[Linked/Escaped]].')
      const seed = await seedSource(invoke, 'Source', content)

      await expect(invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source', content, seed.revision, seed.sourceStoreId)).rejects.toThrow(
        'Failed to auto-create note for wikilink "Linked/Escaped": Invalid note path',
      )
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('rolls back already-created targets and leaves the source bytes unchanged', async () => {
    const { invoke } = createHarness()
    mkdirSync(notesRoot(), { recursive: true })
    const outsideDir = mkdtempSync(join(tmpdir(), 'notes-autocreate-outside-'))
    symlinkSync(outsideDir, join(notesRoot(), 'Linked'))
    try {
      const sourcePath = join(notesRoot(), 'Source.md')
      const content = noteContent('Source', 'Create [[First Target]], then fail [[Linked/Escaped]].')
      const seed = await seedSource(invoke, 'Source', content)
      const sourceBytes = readFileSync(sourcePath, 'utf-8')

      await expect(invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source', content, seed.revision, seed.sourceStoreId)).rejects.toThrow(
        /Failed to auto-create note for wikilink "Linked\/Escaped"/,
      )

      expect(existsSync(join(notesRoot(), 'First Target.md'))).toBe(false)
      expect(existsSync(join(outsideDir, 'Escaped.md'))).toBe(false)
      expect(readFileSync(sourcePath, 'utf-8')).toBe(sourceBytes)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('honours frontmatter createdAt over the file birthtime', async () => {
    const { invoke } = createHarness()
    const createdAt = Date.UTC(2026, 8, 2, 12, 0, 0)
    const content = noteContent('Stamped', 'No links here.', new Date(createdAt).toISOString())
    const seed = await seedSource(invoke, 'Stamped', content)

    const saved = await invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Stamped', content, seed.revision, seed.sourceStoreId)

    expect(saved.createdAt).toBe(createdAt)
  })

  it('creates a raced target exactly once', async () => {
    const { invoke } = createHarness()
    const contentA = noteContent('Source A', 'See [[Race Note]].')
    const contentB = noteContent('Source B', 'See [[Race Note]].')
    const seedA = await seedSource(invoke, 'Source A', contentA)
    const seedB = await seedSource(invoke, 'Source B', contentB)

    const results = await Promise.all([
      invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source A', contentA, seedA.revision, seedA.sourceStoreId),
      invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source B', contentB, seedB.revision, seedB.sourceStoreId),
    ])

    const created = results.flatMap((note) => note.autoCreatedNoteIds ?? []).filter((id) => id === 'Race Note')
    expect(created).toHaveLength(1)
    expect(readdirSync(notesRoot()).filter((name) => name === 'Race Note.md')).toHaveLength(1)
  })
})