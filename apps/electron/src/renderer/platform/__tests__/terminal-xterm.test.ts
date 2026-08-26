import { describe, expect, it } from 'bun:test'
import {
  isXtermMountEnabled,
  mountTerminalXterm,
  planD2Restore,
  planXtermMount,
} from '../terminal-xterm.tsx'

const FLAG_TERMINAL = 'workbench.terminal.v1'
const FLAG_COORDINATOR = 'execution.coordinator.v1'
const BOTH = new Set([FLAG_TERMINAL, FLAG_COORDINATOR])

describe('terminal-xterm spike stub', () => {
  it('AC-1 flag-off skip', () => {
    expect(isXtermMountEnabled(new Set())).toBe(false)
    expect(planXtermMount(new Set())).toEqual({ kind: 'skipped', reason: 'flag-off' })
    expect(mountTerminalXterm(null, new Set())).toBeNull()
  })

  it('AC-2 flag-on stub plan', () => {
    expect(isXtermMountEnabled(BOTH)).toBe(true)
    expect(planXtermMount(BOTH)).toEqual({
      kind: 'stub',
      adapter: 'xterm.js',
      pty: 'native-crate-unwired',
    })
  })

  it('AC-3 single-flag still off', () => {
    expect(isXtermMountEnabled(new Set([FLAG_TERMINAL]))).toBe(false)
    expect(isXtermMountEnabled(new Set([FLAG_COORDINATOR]))).toBe(false)
  })

  it('AC-4 D2 napi honesty', () => {
    expect(planD2Restore({ adapter: 'napi', terminalId: 't1', sidecarAlive: true })).toEqual({
      status: 'unsupported',
      reason: 'napi-main-died',
    })
  })

  it('AC-5 D2 sidecar restore vs dead', () => {
    expect(planD2Restore({ adapter: 'sidecar', terminalId: 't1', sidecarAlive: true })).toEqual({
      status: 'restore',
      terminalId: 't1',
      via: 'snapshot-barrier',
    })
    expect(planD2Restore({ adapter: 'sidecar', terminalId: 't1', sidecarAlive: false })).toEqual({
      status: 'unsupported',
      reason: 'sidecar-dead',
    })
  })

  it('EC-5 missing terminalId is not-found', () => {
    expect(planD2Restore({ adapter: 'sidecar', terminalId: '', sidecarAlive: true })).toEqual({
      status: 'unsupported',
      reason: 'not-found',
    })
  })

})
