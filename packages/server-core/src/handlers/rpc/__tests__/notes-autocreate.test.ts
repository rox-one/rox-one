import '../memory-test-setup' // must run before modules reading CRAFT_CONFIG_DIR
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS, type NoteDocument } from '@craft-agent/shared/protocol'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import type { RpcServer, HandlerFn, RequestContext } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

let workspaceRoot: string

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => {
    if (id === 'ws1') return { id: 'ws1', name: 'ws1', rootPath: workspaceRoot }
    return null
  },
  getWorkspaces: () => [{ id: 'ws1', name: 'ws1', rootPath: workspaceRoot }],
}))

import { registerNotesHandlers } from '../notes'

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel, target, ...args) { pushCalls.push({ channel, target, args }) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps = {
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
  } satisfies HandlerDeps

  registerNotesHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null, webContentsId: null } as RequestContext, ...args)
  }
  return { invoke, pushCalls }
}

function notesRoot(): string {
  return join(getDefaultWorkspacesDir(), 'ws1', 'notes')
}

function noteContent(title: string, body: string, createdAt: string | number = 1_787_961_600_000): string {
  return `---\ntitle: ${title}\ntags: []\ncreatedAt: ${createdAt}\n---\n\n${body}`
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'notes-autocreate-ws-'))
  rmSync(getDefaultWorkspacesDir(), { recursive: true, force: true })
})

describe('notes wikilink autocreate', () => {
  it('creates one linked note and keeps repeated saves idempotent', async () => {
    const { invoke } = createHarness()
    const first = await invoke(
      RPC_CHANNELS.notes.SAVE,
      'ws1',
      'Source',
      noteContent('Source', 'See [[Linked Note]] and [[Linked Note.md]].'),
    ) as NoteDocument
    expect(first.autoCreatedNoteIds).toEqual(['Linked Note'])

    const linkedPath = join(notesRoot(), 'Linked Note.md')
    const firstLinkedContent = readFileSync(linkedPath, 'utf-8')
    const second = await invoke(
      RPC_CHANNELS.notes.SAVE,
      'ws1',
      'Source',
      noteContent('Source', 'See [[Linked Note]] and [[Linked Note.md]].'),
    ) as NoteDocument
    expect(second.autoCreatedNoteIds).toEqual([])
    expect(readFileSync(linkedPath, 'utf-8')).toBe(firstLinkedContent)
    expect(readdirSync(notesRoot()).filter(name => name === 'Linked Note.md')).toHaveLength(1)
  })

  it('ignores protected, hidden, traversal, and malformed wikilink targets', async () => {
    const { invoke } = createHarness()
    const result = await invoke(
      RPC_CHANNELS.notes.SAVE,
      'ws1',
      'Source',
      noteContent(
        'Source',
        [
          'Good [[Good Note]].',
          'Protected [[assets/Leak]] and [[templates/Leak]].',
          'Hidden [[.private/Leak]].',
          'Traversal [[../Escape]].',
          'Newline [[Bad',
          'Target]].',
          'Nested [[Nested [[Bad]]]].',
          'Reserved char [[Bad:Target]].',
        ].join('\n'),
      ),
    ) as NoteDocument

    expect(result.autoCreatedNoteIds).toEqual(['Good Note'])
    expect(existsSync(join(notesRoot(), 'Good Note.md'))).toBe(true)
    expect(existsSync(join(notesRoot(), 'assets', 'Leak.md'))).toBe(false)
    expect(existsSync(join(notesRoot(), 'templates', 'Leak.md'))).toBe(false)
    expect(existsSync(join(notesRoot(), '.private', 'Leak.md'))).toBe(false)
    expect(existsSync(join(getDefaultWorkspacesDir(), 'ws1', 'Escape.md'))).toBe(false)
    expect(existsSync(join(notesRoot(), 'Nested [[Bad.md'))).toBe(false)
    expect(existsSync(join(notesRoot(), 'Bad_Target.md'))).toBe(false)
  })

  it('leaves the source unchanged when a linked target cannot be auto-created', async () => {
    const { invoke } = createHarness()
    mkdirSync(notesRoot(), { recursive: true })
    const sourcePath = join(notesRoot(), 'Source.md')
    const previousSource = noteContent('Source', 'The previous version must survive.')
    writeFileSync(sourcePath, previousSource, 'utf-8')
    const outsideDir = mkdtempSync(join(tmpdir(), 'notes-autocreate-outside-'))
    symlinkSync(outsideDir, join(notesRoot(), 'Linked'))

    await expect(invoke(
      RPC_CHANNELS.notes.SAVE,
      'ws1',
      'Source',
      noteContent('Source', 'Create [[First Target]], then fail [[Linked/Escaped]].'),
    )).rejects.toThrow('Failed to auto-create note for wikilink "Linked/Escaped": Invalid note path')
    expect(existsSync(join(outsideDir, 'Escaped.md'))).toBe(false)
    expect(existsSync(join(notesRoot(), 'First Target.md'))).toBe(false)
    expect(readFileSync(sourcePath, 'utf-8')).toBe(previousSource)
  })

  it('creates only one target when two saves race', async () => {
    const { invoke } = createHarness()
    const results = await Promise.all([
      invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source A', noteContent('Source A', 'See [[Race Note]].')),
      invoke(RPC_CHANNELS.notes.SAVE, 'ws1', 'Source B', noteContent('Source B', 'See [[Race Note]].')),
    ]) as NoteDocument[]

    expect(results.flatMap(result => result.autoCreatedNoteIds ?? []).filter(id => id === 'Race Note')).toHaveLength(1)
    expect(readdirSync(notesRoot()).filter(name => name === 'Race Note.md')).toHaveLength(1)
  })

  it('uses frontmatter createdAt before filesystem birthtime', async () => {
    const { invoke } = createHarness()
    const createdAt = Date.UTC(2026, 8, 2, 12, 0, 0)
    const saved = await invoke(
      RPC_CHANNELS.notes.SAVE,
      'ws1',
      'Stamped',
      noteContent('Stamped', 'body', new Date(createdAt).toISOString()),
    ) as NoteDocument

    expect(saved.createdAt).toBe(createdAt)
  })
})
