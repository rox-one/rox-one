import { afterEach, expect, test } from 'bun:test'
import { createNativeNotesSyncController } from '../native-notes-sync'
import type { NoteDocument } from '../../../shared/types'

const originalWindow = globalThis.window
afterEach(() => { globalThis.window = originalWindow })
const note = { id: 'note-a' } as NoteDocument
const snapshot = { workspaceId: 'workspace-a', kind: 'notes', nativeId: 'note-a', revision: 1, deleted: false, files: [{ path: 'notes/note-a.md', content: 'before' }] }
const operation = { workspaceId: 'workspace-a', kind: 'notes', nativeId: 'note-a', operationId: 'op-a', expectedRevision: 1, schemaVersion: 1, changes: [{ path: 'notes/note-a.md', content: 'after' }] }

function install(overrides: Record<string, unknown> = {}) {
  const calls = { enqueue: 0, mutate: 0, acknowledge: 0, closed: [] as string[] }
  globalThis.window = { electronAPI: {
    getTransportConnectionState: async () => ({ status: 'connected' }),
    nativeData: {
      readEntity: async () => snapshot,
      mutate: async () => { calls.mutate++; return { operationId: 'op-a' } },
      ...(overrides.nativeData as object),
    },
    nativeReplica: {
      open: async (workspace: string) => `handle-${workspace}`,
      close: async (handle: string) => { calls.closed.push(handle) },
      pending: async () => [operation],
      enqueue: async () => { calls.enqueue++; return operation },
      acknowledge: async () => { calls.acknowledge++; return true },
      ...(overrides.nativeReplica as object),
    },
  } } as unknown as Window & typeof globalThis
  return calls
}

test('workspace switch during authoritative read never queues the old snapshot', async () => {
  const read = Promise.withResolvers<typeof snapshot>()
  const calls = install({ nativeData: { readEntity: () => read.promise } })
  const controller = createNativeNotesSyncController()
  await controller.start('workspace-a')
  const save = controller.queueSave(note, 'after')
  await controller.start('workspace-b')
  read.resolve(snapshot)
  await expect(save).rejects.toThrow('workspace changed')
  expect(calls.enqueue).toBe(0)
  await controller.stop()
})

test('workspace switch while loading the durable queue never submits the old mutation', async () => {
  const pending = Promise.withResolvers<typeof operation[]>()
  const calls = install({ nativeReplica: { pending: () => pending.promise } })
  const controller = createNativeNotesSyncController()
  await controller.start('workspace-a')
  const flush = controller.flush()
  await Promise.resolve()
  await controller.start('workspace-b')
  pending.resolve([operation])
  await expect(flush).rejects.toThrow('workspace changed')
  expect(calls.mutate).toBe(0)
  expect(calls.acknowledge).toBe(0)
  await controller.stop()
})

test('stop fences an in-flight server receipt and leaves it for idempotent retry', async () => {
  const receipt = Promise.withResolvers<{ operationId: string }>()
  const submitted = Promise.withResolvers<void>()
  const calls = install({ nativeData: { mutate: () => { submitted.resolve(); return receipt.promise } } })
  const controller = createNativeNotesSyncController()
  await controller.start('workspace-a')
  const flush = controller.flush()
  await submitted.promise
  await controller.stop()
  receipt.resolve({ operationId: 'op-a' })
  await expect(flush).rejects.toThrow('workspace changed')
  expect(calls.acknowledge).toBe(0)
})

test('overlapping workspace starts keep the last requested workspace and close obsolete opens', async () => {
  const first = Promise.withResolvers<string>()
  const calls = install({ nativeReplica: { open: (workspace: string) => workspace === 'workspace-a' ? first.promise : Promise.resolve(`handle-${workspace}`) } })
  const controller = createNativeNotesSyncController()
  const a = controller.start('workspace-a')
  const b = controller.start('workspace-b')
  const c = controller.start('workspace-c')
  await c
  first.resolve('handle-workspace-a')
  await Promise.all([a, b])
  await controller.stop()
  expect(calls.closed).toEqual(['handle-workspace-a', 'handle-workspace-c'])
})

test('a canonical read for another native identity cannot enter the durable Notes outbox', async () => {
  const calls = install({ nativeData: { readEntity: async () => ({ ...snapshot, nativeId: 'another-note' }) } })
  const controller = createNativeNotesSyncController()
  await controller.start('workspace-a')
  try {
    await expect(controller.queueSave({ ...note, nativeId: 'note-a', nativeRevision: 1 }, 'after')).rejects.toThrow('identity changed')
    expect(calls.enqueue).toBe(0)
  } finally { await controller.stop() }
})

test('a concurrent canonical revision discovered after the await preserves the opened draft', async () => {
  const read = Promise.withResolvers<typeof snapshot>()
  const calls = install({ nativeData: { readEntity: () => read.promise } })
  const controller = createNativeNotesSyncController()
  await controller.start('workspace-a')
  const save = controller.queueSave({ ...note, nativeId: 'note-a', nativeRevision: 1 }, 'my unsaved draft')
  read.resolve({ ...snapshot, revision: 2, files: [{ ...snapshot.files[0]!, content: 'another writer changed this' }] })
  try {
    await expect(save).rejects.toThrow('revision changed')
    expect(calls.enqueue).toBe(0)
    expect(calls.mutate).toBe(0)
  } finally { await controller.stop() }
})

test('missing opened native revision cannot be upgraded to a fresh write grant', async () => {
  const calls = install()
  const controller = createNativeNotesSyncController()
  await controller.start('workspace-a')
  try {
    await expect(controller.queueSave(note, 'unbound draft')).rejects.toThrow('opened revision')
    expect(calls.enqueue).toBe(0)
  } finally { await controller.stop() }
})

test('a matching opened identity and revision uses the existing main-owned enqueue and receipt ACK', async () => {
  const calls = install()
  const controller = createNativeNotesSyncController()
  await controller.start('workspace-a')
  try {
    const queued = await controller.queueSave({ ...note, nativeId: 'note-a', nativeRevision: 1 }, 'after')
    expect(queued.expectedRevision).toBe(1)
    await controller.flush()
    expect(calls.enqueue).toBe(1)
    expect(calls.mutate).toBe(1)
    expect(calls.acknowledge).toBe(1)
  } finally { await controller.stop() }
})

test('only an observed main ACK advances the same opened draft through its own queued revision chain', async () => {
  let revision = 1
  let pending: typeof operation[] = []
  let nextOperation = 0
  install({
    nativeData: {
      readEntity: async () => ({ ...snapshot, revision }),
      mutate: async (input: typeof operation) => ({ ...input, revision: input.expectedRevision + 1, issuer: 'issuer', subject: 'subject', sequence: input.expectedRevision + 1, contentHash: 'a'.repeat(64), deleted: false }),
    },
    nativeReplica: {
      enqueue: async (_handle: string, input: typeof operation) => {
        const queued = { ...operation, ...input, operationId: `own-${++nextOperation}`, expectedRevision: pending.at(-1)?.expectedRevision! + 1 || revision }
        pending.push(queued)
        return queued
      },
      pending: async () => [...pending],
      acknowledge: async (_handle: string, receipt: { operationId: string; revision: number }) => {
        revision = receipt.revision
        pending = pending.filter(op => op.operationId !== receipt.operationId)
        return true
      },
    },
  })
  const controller = createNativeNotesSyncController()
  const opened = { ...note, nativeId: 'note-a', nativeRevision: 1 }
  await controller.start('workspace-a')
  try {
    await controller.queueSave(opened, 'first offline draft')
    expect((await controller.queueSave(opened, 'second offline draft')).expectedRevision).toBe(2)
    expect((await controller.flush()).map(receipt => receipt.revision)).toEqual([2, 3])
    expect((await controller.queueSave(opened, 'after own ACK')).expectedRevision).toBe(3)
    await controller.flush()
    revision = 5 // An external writer advanced the canonical snapshot beyond our own receipt.
    await expect(controller.queueSave(opened, 'preserve this draft')).rejects.toThrow('revision changed')
    expect(pending).toEqual([])
  } finally { await controller.stop() }
})

test('an unacknowledged or mismatched receipt cannot grant revision progression', async () => {
  let revision = 1
  install({
    nativeData: {
      readEntity: async () => ({ ...snapshot, revision }),
      mutate: async () => ({ ...operation, nativeId: 'another-note', revision: 2 }),
    },
    nativeReplica: { acknowledge: async () => true },
  })
  const controller = createNativeNotesSyncController()
  const opened = { ...note, nativeId: 'note-a', nativeRevision: 1 }
  await controller.start('workspace-a')
  try {
    await controller.queueSave(opened, 'draft')
    await controller.flush()
    revision = 2
    await expect(controller.queueSave(opened, 'still bound to revision 1')).rejects.toThrow('revision changed')
  } finally { await controller.stop() }
})
