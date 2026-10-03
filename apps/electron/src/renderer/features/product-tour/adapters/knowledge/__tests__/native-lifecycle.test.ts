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
