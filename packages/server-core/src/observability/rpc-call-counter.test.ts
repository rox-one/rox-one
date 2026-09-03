import { describe, expect, it } from 'bun:test'
import { RpcCallCounter } from './rpc-call-counter.ts'

describe('RpcCallCounter', () => {
  it('wraps a handler and counts invocations', () => {
    const counter = new RpcCallCounter()
    const getPermission = counter.wrap('sessions.permission', (id: string) => `mode:${id}`)
    expect(getPermission('a')).toBe('mode:a')
    expect(getPermission('b')).toBe('mode:b')
    expect(counter.get('sessions.permission')).toBe(2)
  })

  it('flags permission/metadata N+1 against a session list', () => {
    const counter = new RpcCallCounter()
    for (let i = 0; i < 50; i++) {
      counter.record('sessions.permission')
      counter.record('sessions.metadata')
    }
    expect(counter.detectSessionMetadataNPlusOne(50)).toEqual([
      'sessions.permission called 50 times for 50 sessions',
      'sessions.metadata called 50 times for 50 sessions',
    ])
  })

  it('allows a single batched metadata fetch', () => {
    const counter = new RpcCallCounter()
    counter.record('sessions.list')
    counter.record('sessions.metadata')
    expect(counter.detectSessionMetadataNPlusOne(2000)).toEqual([])
  })
})
