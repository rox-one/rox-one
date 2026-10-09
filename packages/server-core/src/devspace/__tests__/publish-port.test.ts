import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarkdownCommitStore, markdownRevision, type MarkdownCommitOwner } from '../../docs/markdown-commit.ts'
import { createDevSpacePublishPort, type DevSpacePublishBinding } from '../publish-port.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const WORKSPACE = 'ws'
const SOURCE = 'native-notes:ws:test-store'
const PRINCIPAL = 'server-devspace-publisher'
const NOTE_ID = 'projects/demo/dev-space/wiki/index'

function compose(options: { readonly authorize?: boolean; readonly changed?: () => Promise<void> } = {}) {
  const notesRoot = mkdtempSync(join(tmpdir(), 'rox-devspace-port-'))
  roots.push(notesRoot)
  const allowed = options.authorize ?? true
  const owner: MarkdownCommitOwner = {
    async authorize(actor, command) { return allowed && actor === PRINCIPAL && command.workspaceId === WORKSPACE },
    async authorizeNative(actor, command) { return allowed && actor === PRINCIPAL && command.workspaceId === WORKSPACE },
    authorityEpoch: async () => 1,
    requireSourceBinding: true,
    sourceStoreId: async () => SOURCE,
    changed: options.changed ? async () => { await options.changed!() } : undefined,
  }
  const store = new MarkdownCommitStore(notesRoot, owner)
  const binding: DevSpacePublishBinding = {
    actorPrincipalId: PRINCIPAL, workspaceId: WORKSPACE, sourceStoreId: SOURCE, authorityEpoch: 1,
  }
  return { notesRoot, store, binding, port: createDevSpacePublishPort(store, binding) }
}

describe('createDevSpacePublishPort', () => {
  it('reads null for an absent note', async () => {
    const { port } = compose()
    expect(await port.read(WORKSPACE, NOTE_ID)).toBeNull()
  })

  it('creates an absent note through the writeNative path and reads the bytes back', async () => {
    const { notesRoot, port } = compose()
    const result = await port.write({ workspaceId: WORKSPACE, noteId: NOTE_ID, content: '# Hello\n', expectedRevision: null, operationId: 'op-create' })
    expect(result).toMatchObject({ status: 'committed', revision: markdownRevision('# Hello\n'), previousRevision: markdownRevision(''), operationId: 'op-create' })
    expect(readFileSync(join(notesRoot, `${NOTE_ID}.md`), 'utf8')).toBe('# Hello\n')
    expect(await port.read(WORKSPACE, NOTE_ID)).toEqual({ revision: markdownRevision('# Hello\n'), content: '# Hello\n' })
  })

  it('updates with a matching revision through the commit path and reports the previous revision', async () => {
    const { port } = compose()
    await port.write({ workspaceId: WORKSPACE, noteId: NOTE_ID, content: '# One\n', expectedRevision: null, operationId: 'op-1' })
    const result = await port.write({ workspaceId: WORKSPACE, noteId: NOTE_ID, content: '# Two\n', expectedRevision: markdownRevision('# One\n'), operationId: 'op-2' })
    expect(result).toMatchObject({ status: 'committed', revision: markdownRevision('# Two\n'), previousRevision: markdownRevision('# One\n') })
    expect((await port.read(WORKSPACE, NOTE_ID))?.content).toBe('# Two\n')
  })

  it('surfaces a stale revision as a conflict carrying the current revision', async () => {
    const { port } = compose()
    await port.write({ workspaceId: WORKSPACE, noteId: NOTE_ID, content: '# One\n', expectedRevision: null, operationId: 'op-1' })
    const result = await port.write({ workspaceId: WORKSPACE, noteId: NOTE_ID, content: '# Stale\n', expectedRevision: markdownRevision('# Other\n'), operationId: 'op-3' })
    expect(result).toMatchObject({ status: 'conflict', currentRevision: markdownRevision('# One\n') })
    expect((await port.read(WORKSPACE, NOTE_ID))?.content).toBe('# One\n')
  })

  it('maps an unauthorized principal to denied without leaking a message', async () => {
    const { port } = compose({ authorize: false })
    expect(await port.write({ workspaceId: WORKSPACE, noteId: NOTE_ID, content: '# X\n', expectedRevision: null, operationId: 'op-d' })).toEqual({ status: 'denied' })
  })

  it('refuses a write and read outside the composed workspace', async () => {
    const { port } = compose()
    expect(await port.write({ workspaceId: 'other', noteId: NOTE_ID, content: '# X\n', expectedRevision: null, operationId: 'op-x' })).toEqual({ status: 'denied' })
    expect(await port.read('other', NOTE_ID)).toBeNull()
  })

  it('reports an invalidation-pending write as unavailable, not a failure', async () => {
    const { notesRoot, port } = compose({ changed: async () => { throw new Error('invalidator offline') } })
    expect(await port.write({ workspaceId: WORKSPACE, noteId: NOTE_ID, content: '# Durable\n', expectedRevision: null, operationId: 'op-u' }))
      .toEqual({ status: 'unavailable', detail: 'invalidation-pending' })
    // The bytes are durable even though the event delivery failed.
    expect(readFileSync(join(notesRoot, `${NOTE_ID}.md`), 'utf8')).toBe('# Durable\n')
  })
})