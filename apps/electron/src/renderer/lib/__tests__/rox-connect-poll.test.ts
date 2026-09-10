import { describe, expect, it } from 'bun:test'
import {
  decideRoxConnectPoll,
  roxConnectDeadline,
  ROX_CONNECT_MIN_TTL_SEC,
} from '../rox-connect-poll'

describe('roxConnectDeadline', () => {
  it('uses expiresIn when it is longer than the minimum TTL', () => {
    expect(roxConnectDeadline(300, 1_000)).toBe(1_000 + 300_000)
  })

  it('floors missing or tiny TTL to 60 seconds', () => {
    expect(roxConnectDeadline(undefined, 0)).toBe(ROX_CONNECT_MIN_TTL_SEC * 1000)
    expect(roxConnectDeadline(5, 0)).toBe(ROX_CONNECT_MIN_TTL_SEC * 1000)
  })
})

describe('decideRoxConnectPoll', () => {
  it('prefers connected over expiry', () => {
    expect(
      decideRoxConnectPoll({ now: 10, deadline: 1, connected: true }),
    ).toEqual({ action: 'connected' })
  })

  it('stops with expired after the deadline', () => {
    expect(decideRoxConnectPoll({ now: 10, deadline: 10 })).toEqual({ action: 'expired' })
    expect(decideRoxConnectPoll({ now: 9, deadline: 10 })).toEqual({ action: 'continue' })
  })

  it('maps main DEVICE_CODE_EXPIRED to expired', () => {
    expect(
      decideRoxConnectPoll({
        now: 0,
        deadline: 100,
        connectError: 'DEVICE_CODE_EXPIRED',
      }),
    ).toEqual({ action: 'expired' })
  })

  it('surfaces poll/state-read failure instead of swallowing it', () => {
    expect(
      decideRoxConnectPoll({
        now: 0,
        deadline: 100,
        stateReadFailed: true,
        stateReadError: 'network down',
      }),
    ).toEqual({ action: 'failed', message: 'network down' })
  })

  it('does not treat a superseded flow as a renderer error', () => {
    expect(
      decideRoxConnectPoll({
        now: 0,
        deadline: 100,
        connectError: 'ROX_CONNECT_CANCELLED',
      }),
    ).toEqual({ action: 'continue' })
  })
})
