import { describe, expect, it } from 'bun:test'
import {
  PTY_OPTIONS,
  choosePty,
  probeCraftExec,
  probeMultiplexer,
  probeNativeCrate,
  probeNodePty,
  ptyBytesFitInRpcEnvelope,
} from './harness'

describe('G1 PTY spike harness', () => {
  it('enumerates the four FR-20 options', () => {
    expect(PTY_OPTIONS).toEqual([
      'craft-exec-extended',
      'native-crate',
      'node-pty',
      'multiplexer',
    ])
  })

  it('chooses native-crate and rejects the other three', () => {
    const decision = choosePty()
    expect(decision.chosen).toBe('native-crate')
    expect(decision.rejected).toEqual([
      'craft-exec-extended',
      'node-pty',
      'multiplexer',
    ])
    expect(decision.risk.length).toBeGreaterThan(0)
  })

  it('probe stubs throw until the spike is run', () => {
    expect(() => probeCraftExec()).toThrow('not implemented in spike until run')
    expect(() => probeNativeCrate()).toThrow('not implemented in spike until run')
    expect(() => probeNodePty()).toThrow('not implemented in spike until run')
    expect(() => probeMultiplexer()).toThrow('not implemented in spike until run')
  })

  it('does not place PTY bytes on JSON-RPC envelopes', () => {
    expect(ptyBytesFitInRpcEnvelope()).toBe(false)
  })
})
