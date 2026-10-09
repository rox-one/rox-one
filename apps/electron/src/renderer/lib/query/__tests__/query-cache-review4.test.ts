/**
 * PERF-09 (#1576) review round 4: `sharedRead` must not remember a read that
 * threw before it could be tracked as in flight. The read callback is called
 * synchronously, so a throw used to run the `finally` (clearing nothing) before
 * the rejected promise was remembered — every later `join` read re-rejected
 * without calling the callback again.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { createRoxQueryClient, resetRoxQueryClientForTests, roxQueryClient } from '../client'
import { roxKeys } from '../keys'
import { sharedRead } from '../shared-read'

beforeEach(() => { resetRoxQueryClientForTests(createRoxQueryClient()) })

const failureMessage = (promise: Promise<unknown>) =>
  promise.then(() => null, (error: unknown) => error instanceof Error ? error.message : String(error))

describe('PERF-09 round 4: a synchronously throwing read is not left remembered in flight', () => {
  it('a later join read calls the callback again instead of re-rejecting the stored promise', async () => {
    const client = roxQueryClient()
    const key = roxKeys.notesList('ws')
    let calls = 0
    const explode = (): Promise<string[]> => { calls++; throw new Error('boom') }
    expect(await failureMessage(sharedRead(client, key, explode, { join: true }))).toBe('boom')
    expect(calls).toBe(1)
    // The rejected promise must not be what later join reads receive.
    expect(await failureMessage(sharedRead(client, key, explode, { join: true }))).toBe('boom')
    expect(calls).toBe(2)
    // A read that completes still publishes its value and clears the entry.
    const notes = ['ok']
    expect(await sharedRead(client, key, async () => { calls++; return notes }, { join: true })).toBe(notes)
    expect(calls).toBe(3)
    expect(client.getQueryData<string[]>(key)).toBe(notes)
    expect(await sharedRead(client, key, async () => ['again'], { join: true })).toEqual(['again'])
  })
})