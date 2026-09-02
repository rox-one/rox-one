import { beforeEach, describe, expect, it } from 'bun:test'
import {
  clearIpcCalls,
  detectSessionIpcNPlusOne,
  recordIpcInvoke,
  snapshotIpcCalls,
} from '../ipc-counter'

describe('ipc-call-counter', () => {
  beforeEach(() => {
    clearIpcCalls()
  })

  it('counts invokes and payload bytes', () => {
    recordIpcInvoke('sessions:get', 128)
    recordIpcInvoke('sessions:get', 64)
    const snap = snapshotIpcCalls()
    expect(snap['sessions:get']?.count).toBe(2)
    expect(snap['sessions:get']?.totalResultBytes).toBe(192)
  })

  it('flags permission-mode N+1 after a collection load', () => {
    const delta = {
      'sessions:get': { channel: 'sessions:get', count: 1, totalResultBytes: 10 },
      'sessions:getPermissionModeState': { channel: 'sessions:getPermissionModeState', count: 2000, totalResultBytes: 0 },
    }
    const findings = detectSessionIpcNPlusOne(delta, 2000, { allowCollectionGet: true })
    expect(findings.some((f) => f.kind === 'permission-mode' && f.fanout === 2000)).toBe(true)
  })

  it('flags a collection reload on a cached switch', () => {
    const findings = detectSessionIpcNPlusOne(
      { 'sessions:get': { channel: 'sessions:get', count: 1, totalResultBytes: 0 } },
      2000,
      { allowCollectionGet: false, messagesAlreadyCached: true },
    )
    expect(findings.some((f) => f.kind === 'collection-reload')).toBe(true)
  })

  it('accepts a single batched collection get', () => {
    const findings = detectSessionIpcNPlusOne(
      { 'sessions:get': { channel: 'sessions:get', count: 1, totalResultBytes: 40 } },
      2000,
      { allowCollectionGet: true },
    )
    expect(findings).toEqual([])
  })
})
