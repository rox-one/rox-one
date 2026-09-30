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
