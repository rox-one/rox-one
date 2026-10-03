import { expect, test, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
let bridge: any
const calls: unknown[][] = []
const ipc = Object.assign(new EventEmitter(), { invoke: (...args: unknown[]) => {
  calls.push(args)
  if (args[1] === 'snapshot') return new Promise(resolve => snapshots.push(resolve))
  return Promise.resolve({ ok: true })
} })
const snapshots: ((value: unknown) => void)[] = []
mock.module('electron', () => ({ contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { expect(name).toBe('voiceOverlay'); bridge = value } }, ipcRenderer: ipc }))
await import('../voice-overlay')
test('private preload has only scoped controls and snapshot/event/unsubscribe ordering', async () => {
  expect(Object.keys(bridge).sort()).toEqual(['cancel', 'onState', 'stop'])
  const values: unknown[] = []
  const dispose = bridge.onState((state: unknown) => values.push(state))
  const state = { recordingId: 'current-recording', phase: 'recording' }
  ipc.emit('rox:owned-voice-overlay:state', {}, state)
  snapshots.shift()!({ ok: true, state: { recordingId: 'stale', phase: 'permission' } })
  await Promise.resolve()
  expect(values).toEqual([state])
  await bridge.stop('original-rendered-recording')
  expect(calls.at(-1)).toEqual(['rox:owned-voice-overlay:command', 'stop', 'original-rendered-recording'])
  dispose(); expect(ipc.listenerCount('rox:owned-voice-overlay:state')).toBe(0)
  const disposeSecond = bridge.onState((state: unknown) => values.push(state))
  disposeSecond(); snapshots.shift()!({ ok: true, state: { recordingId: 'late', phase: 'recording' } })
  await Promise.resolve(); expect(values).toEqual([state])
})
