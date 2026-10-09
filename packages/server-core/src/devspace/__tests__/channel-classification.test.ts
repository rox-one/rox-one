import { describe, expect, it } from 'bun:test'
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS, RPC_CHANNELS } from '@rox/shared/protocol'

describe('devSpace:startRun channel classification', () => {
  it('classifies every devSpace channel local-only and never remote-eligible', () => {
    for (const channel of Object.values(RPC_CHANNELS.devSpace)) {
      expect(LOCAL_ONLY_CHANNELS.has(channel)).toBe(true)
      expect(REMOTE_ELIGIBLE_CHANNELS.has(channel)).toBe(false)
    }
  })

  it('includes the new startRun channel in the local-only set', () => {
    expect(RPC_CHANNELS.devSpace.START_RUN).toBe('devSpace:startRun')
    expect(LOCAL_ONLY_CHANNELS.has(RPC_CHANNELS.devSpace.START_RUN)).toBe(true)
  })
})