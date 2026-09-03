import { describe, expect, it } from 'bun:test'
import { IpcCallCounter } from '../ipc-counter'

describe('IpcCallCounter', () => {
  it('detects session permission/metadata N+1', () => {
    const ipc = new IpcCallCounter()
    ipc.record('sessions.list')
    for (let i = 0; i < 500; i++) {
      ipc.record('sessions.permission')
      ipc.record('sessions.metadata')
    }
    expect(ipc.detectSessionMetadataNPlusOne(500).length).toBe(2)
  })

  it('accepts a batched list plus one metadata fetch', () => {
    const ipc = new IpcCallCounter()
    ipc.record('sessions.list')
    ipc.record('sessions.metadata')
    expect(ipc.detectSessionMetadataNPlusOne(2000)).toEqual([])
  })
})
