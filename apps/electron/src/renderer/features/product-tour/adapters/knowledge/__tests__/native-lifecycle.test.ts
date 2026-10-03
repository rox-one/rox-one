import { expect, test } from 'bun:test'
import { createNativeReplicaBridge } from '../../../../../../preload/native-replica'
import { createNativeNotesSyncController } from '../../../../../lib/native-notes-sync'
import { NATIVE_REPLICA_IPC } from '@rox/shared/protocol/native-replica'
import { RPC_CHANNELS } from '@rox/shared/protocol'

test('StrictMode start/stop/start waits for obsolete production bridge close before reopening', async () => {
  const opening = Promise.withResolvers<string>()
  const started = Promise.withResolvers<void>()
  let opens = 0
  const bridge = createNativeReplicaBridge({
    client: {
      invoke: async channel => {
        if (channel === RPC_CHANNELS.nativeData.GET_CONTEXT) return { issuer: 'issuer', subject: 'subject', workspaceId: 'workspace', permissionFence: 'fence' }
        throw new Error('Unexpected channel')
      },
      getConnectionState: () => ({ status: 'connected', mode: 'local', url: 'ws://fixture', attempt: 0, updatedAt: 1 }),
      onConnectionStateChanged: () => () => {},
    },
    invokeIpc: async channel => {
      if (channel === NATIVE_REPLICA_IPC.OPEN) {
        if (++opens === 1) { started.resolve(); return opening.promise }
        return 'reopened'
      }
      if (channel === NATIVE_REPLICA_IPC.PENDING) return []
      if (channel === NATIVE_REPLICA_IPC.CLOSE) return
      throw new Error('Unexpected IPC')
    },
  })
  const controller = createNativeNotesSyncController({ nativeReplica: bridge.nativeReplica, nativeData: { readEntity: bridge.readEntity, mutate: bridge.mutate }, getTransportConnectionState: async () => ({ status: 'connected' }) })
  const first = controller.start('workspace')
  await started.promise
  const stop = controller.stop()
  const remount = controller.start('workspace')
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
  expect(opens).toBe(1)
  opening.resolve('obsolete')
  await Promise.all([first, stop, remount])
  expect(await controller.flush()).toEqual([])
  expect(opens).toBe(2)
  await controller.stop()
  bridge.dispose()
})

test('a replacement controller sharing the production bridge waits for an obsolete opening to close', async () => {
  const opening = Promise.withResolvers<string>()
  const started = Promise.withResolvers<void>()
  const closed: string[] = []
  let opens = 0
  const bridge = createNativeReplicaBridge({
    client: {
      invoke: async channel => {
        if (channel === RPC_CHANNELS.nativeData.GET_CONTEXT) return { issuer: 'issuer', subject: 'subject', workspaceId: 'workspace', permissionFence: 'fence' }
        throw new Error('Unexpected channel')
      },
      getConnectionState: () => ({ status: 'connected', mode: 'local', url: 'ws://fixture', attempt: 0, updatedAt: 1 }),
      onConnectionStateChanged: () => () => {},
    },
    invokeIpc: async (channel, input) => {
      if (channel === NATIVE_REPLICA_IPC.OPEN) {
        if (++opens === 1) { started.resolve(); return opening.promise }
        return 'replacement'
      }
      if (channel === NATIVE_REPLICA_IPC.PENDING) return []
      if (channel === NATIVE_REPLICA_IPC.CLOSE) { closed.push((input as { handle: string }).handle); return }
      throw new Error('Unexpected IPC')
    },
  })
  const api = { nativeReplica: bridge.nativeReplica, nativeData: { readEntity: bridge.readEntity, mutate: bridge.mutate }, getTransportConnectionState: async () => ({ status: 'connected' as const }) }
  const firstController = createNativeNotesSyncController(api)
  const replacementController = createNativeNotesSyncController(api)
  const first = firstController.start('workspace')
  await started.promise
  const stop = firstController.stop()
  const replacement = replacementController.start('workspace')
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
  const opensBeforeCleanup = opens
  opening.resolve('obsolete')
  await Promise.all([first, stop, replacement])
  try {
    expect(opensBeforeCleanup).toBe(1)
    expect(closed).toEqual(['obsolete'])
    expect(await replacementController.flush()).toEqual([])
  } finally { await replacementController.stop(); bridge.dispose() }
})

test('closing one bridge handle cannot invalidate another controller opening in flight', async () => {
  const contextRead = Promise.withResolvers<void>()
  const releaseRead = Promise.withResolvers<void>()
  let holdRead = false
  let opens = 0
  const bridge = createNativeReplicaBridge({
    client: {
      invoke: async channel => {
        if (channel !== RPC_CHANNELS.nativeData.GET_CONTEXT) throw new Error('Unexpected channel')
        if (holdRead) { holdRead = false; contextRead.resolve(); await releaseRead.promise }
        return { issuer: 'issuer', subject: 'subject', workspaceId: 'workspace', permissionFence: 'fence' }
      },
      getConnectionState: () => ({ status: 'connected', mode: 'local', url: 'ws://fixture', attempt: 0, updatedAt: 1 }),
      onConnectionStateChanged: () => () => {},
    },
    invokeIpc: async channel => {
      if (channel === NATIVE_REPLICA_IPC.OPEN) return `handle-${++opens}`
      if (channel === NATIVE_REPLICA_IPC.PENDING) return []
      if (channel === NATIVE_REPLICA_IPC.CLOSE) return
      throw new Error('Unexpected IPC')
    },
  })
  const api = { nativeReplica: bridge.nativeReplica, nativeData: { readEntity: bridge.readEntity, mutate: bridge.mutate }, getTransportConnectionState: async () => ({ status: 'connected' as const }) }
  const firstController = createNativeNotesSyncController(api)
  const secondController = createNativeNotesSyncController(api)
  await firstController.start('workspace')
  holdRead = true
  const second = secondController.start('workspace')
  // Attach rejection custody before allowing the old handle to close.
  const result = second.then(() => null, error => error)
  await contextRead.promise
  await firstController.stop()
  releaseRead.resolve()
  try {
    expect(await result).toBeNull()
    expect(await secondController.flush()).toEqual([])
  } finally { await secondController.stop(); bridge.dispose() }
})
