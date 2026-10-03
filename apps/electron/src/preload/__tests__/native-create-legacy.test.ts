import { expect, test } from 'bun:test'
import { RPC_CHANNELS, type NoteDocument } from '@craft-agent/shared/protocol'
import { createNativeReplicaBridge } from '../native-replica'

test('explicit non-native plan preserves legacy create arguments and result without native custody', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = []
  const note: NoteDocument = { id: 'Legacy', title: 'Legacy', path: 'Legacy.md', relativePath: 'Legacy.md', content: '# Legacy\n', tags: [], properties: {}, links: [], assetRefs: [], updatedAt: 1, createdAt: 1, size: 9, backlinks: [] }
  const bridge = createNativeReplicaBridge({
    client: {
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args })
        if (channel === RPC_CHANNELS.notes.PREPARE_CREATE) return null
        if (channel === RPC_CHANNELS.notes.CREATE) return note
        throw new Error('unexpected RPC')
      },
      getConnectionState: () => ({ status: 'connected', mode: 'local', url: 'ws://127.0.0.1:1', attempt: 1, updatedAt: 1 }),
      onConnectionStateChanged: () => () => {},
    },
    invokeIpc: async () => { throw new Error('legacy create must not open native custody') },
  })
  const operation = { operationId: 'legacy-operation', expectedRevision: null, schemaVersion: 1 as const }
  expect(await bridge.createNote('legacy-workspace', 'Legacy', 'folder', operation)).toBe(note)
  expect(calls).toEqual([
    { channel: RPC_CHANNELS.notes.PREPARE_CREATE, args: ['legacy-workspace', 'Legacy', 'folder'] },
    { channel: RPC_CHANNELS.notes.CREATE, args: ['legacy-workspace', 'Legacy', 'folder', operation] },
  ])
  bridge.dispose()
})

test('native planning authorization or transport failure never falls back to legacy creation', async () => {
  let calls = 0
  const bridge = createNativeReplicaBridge({
    client: {
      invoke: async () => { calls++; throw new Error('native authorization denied') },
      getConnectionState: () => ({ status: 'connected', mode: 'local', url: 'ws://127.0.0.1:1', attempt: 1, updatedAt: 1 }),
      onConnectionStateChanged: () => () => {},
    },
    invokeIpc: async () => { throw new Error('denied planning must not enqueue') },
  })
  await expect(bridge.createNote('workspace', 'Denied')).rejects.toThrow('native authorization denied')
  expect(calls).toBe(1)
  bridge.dispose()
})
