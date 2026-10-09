import { describe, expect, it } from 'bun:test'
import { setupI18n } from '@rox/shared/i18n/setupI18n'
import type { RepairDeadlineFactory } from '../transport-wait'
import type { ElectronAPI, TransportConnectionState } from '../../../shared/types'
import {
  createBoundedReconnectRepair,
  MAX_REPAIR_ATTEMPTS,
  REPAIR_BACKOFF_MS,
  waitForTransportConnected,
} from '../transport-wait'

setupI18n().changeLanguage('en')

function createState(overrides?: Partial<TransportConnectionState>): TransportConnectionState {
  return {
    mode: 'remote',
    status: 'disconnected',
    url: 'wss://remote.example.test',
    attempt: 0,
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createApi(initialState: TransportConnectionState): {
  api: Pick<ElectronAPI, 'getTransportConnectionState' | 'onTransportConnectionStateChanged'>
  emit: (state: TransportConnectionState) => void
} {
  let state = initialState
  const listeners = new Set<(state: TransportConnectionState) => void>()

  return {
    api: {
      getTransportConnectionState: async () => state,
      onTransportConnectionStateChanged: (callback) => {
        listeners.add(callback)
        callback(state)
        return () => listeners.delete(callback)
      },
    },
    emit: (next) => {
      state = next
      for (const listener of listeners) listener(next)
    },
  }
}

describe('waitForTransportConnected', () => {
  it('returns immediately when transport is already connected', async () => {
    const connected = createState({ status: 'connected' })
    const { api } = createApi(connected)

    await expect(waitForTransportConnected(api)).resolves.toEqual(connected)
  })

  it('resolves when the transport later becomes connected', async () => {
    const { api, emit } = createApi(createState({ status: 'reconnecting' }))

    const result = waitForTransportConnected(api)
    emit(createState({ status: 'connected', updatedAt: Date.now() + 1 }))

    await expect(result).resolves.toMatchObject({ status: 'connected' })
  })

  it('rejects when the transport enters a failed state', async () => {
    const { api, emit } = createApi(createState({ status: 'reconnecting' }))

    const result = waitForTransportConnected(api)
    emit(createState({
      status: 'failed',
      lastError: { kind: 'auth', message: 'Authentication failed' },
      updatedAt: Date.now() + 1,
    }))

    await expect(result).rejects.toThrow('Authentication failed')
  })

  it('rejects with i18n fallback when failed without lastError', async () => {
    const { api, emit } = createApi(createState({ status: 'reconnecting' }))

    const result = waitForTransportConnected(api)
    emit(createState({
      status: 'failed',
      updatedAt: Date.now() + 1,
    }))

    await expect(result).rejects.toThrow('Connection failed')
  })

  it('rejects with i18n close copy when failed with lastClose', async () => {
    const { api, emit } = createApi(createState({ status: 'reconnecting' }))

    const result = waitForTransportConnected(api)
    emit(createState({
      status: 'failed',
      lastClose: { code: 1006, reason: 'abnormal' },
      updatedAt: Date.now() + 1,
    }))

    await expect(result).rejects.toThrow('WebSocket closed with code 1006 (abnormal).')
  })

  it('times out when the transport never connects', async () => {
    const { api } = createApi(createState({ status: 'reconnecting' }))

    await expect(waitForTransportConnected(api, { timeoutMs: 10 }))
      .rejects.toThrow('Timed out waiting for workspace connection after 10ms')
  })
})

describe('createBoundedReconnectRepair', () => {
  function createFlag() {
    return { armed: false }
  }

  function createManualDeadlines() {
    const pending: Array<() => void> = []
    const createDeadline: RepairDeadlineFactory = () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      pending.push(resolve)
      return { elapsed: promise, cancel: () => resolve() }
    }
    return {
      createDeadline,
      elapse: () => pending[0]?.(),
    }
  }

  async function flushMicrotasks(times = 4) {
    for (let index = 0; index < times; index += 1) await Promise.resolve()
  }

  it('retries a failed load across the documented backoff, then reports repaired', async () => {
    const flag = createFlag()
    flag.armed = true
    const sleeps: number[] = []
    let loads = 0
    const controller = createBoundedReconnectRepair({
      load: async () => {
        loads++
        // The first two loads report failure; the third genuinely succeeds.
        if (loads < 3) {
          flag.armed = true
          return false
        }
        return true
      },
      arm: () => {
        flag.armed = true
      },
      disarm: () => {
        flag.armed = false
      },
      timeoutMs: 1_000,
      createDeadline: createManualDeadlines().createDeadline,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    await expect(controller.run()).resolves.toBe('repaired')
    expect(loads).toBe(3)
    expect(sleeps).toEqual(REPAIR_BACKOFF_MS)
    expect(flag.armed).toBe(false)
    expect(controller.inFlight).toBe(false)
  })

  it('caps the attempts and re-arms when every load fails', async () => {
    const flag = createFlag()
    const sleeps: number[] = []
    let loads = 0
    let exhaustedAt = 0
    const controller = createBoundedReconnectRepair({
      load: async () => {
        loads++
        return false
      },
      arm: () => {
        flag.armed = true
      },
      disarm: () => {
        flag.armed = false
      },
      timeoutMs: 1_000,
      createDeadline: createManualDeadlines().createDeadline,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      onExhausted: (attempts) => {
        exhaustedAt = attempts
      },
    })

    await expect(controller.run()).resolves.toBe('exhausted')
    expect(loads).toBe(MAX_REPAIR_ATTEMPTS)
    expect(sleeps).toEqual(REPAIR_BACKOFF_MS)
    expect(flag.armed).toBe(true)
    expect(exhaustedAt).toBe(MAX_REPAIR_ATTEMPTS)
  })

  it('joins an in-flight repair instead of starting a second concurrent load', async () => {
    const flag = createFlag()
    flag.armed = true
    const gate = Promise.withResolvers<void>()
    let loads = 0
    const controller = createBoundedReconnectRepair({
      load: async () => {
        loads++
        await gate.promise
        return true
      },
      arm: () => {
        flag.armed = true
      },
      disarm: () => {
        flag.armed = false
      },
      timeoutMs: 1_000,
      createDeadline: createManualDeadlines().createDeadline,
    })

    const first = controller.run()
    expect(controller.inFlight).toBe(true)
    await expect(controller.run()).resolves.toBe('in-flight')
    expect(loads).toBe(1)

    gate.resolve()
    await expect(first).resolves.toBe('repaired')
    expect(flag.armed).toBe(false)
    expect(controller.inFlight).toBe(false)
  })

  it('re-arms on a deadline and disarms again once the late load succeeds', async () => {
    const flag = createFlag()
    const deadlines = createManualDeadlines()
    const gate = Promise.withResolvers<void>()
    const lateSuccessDisarmed = Promise.withResolvers<void>()
    let timedOutAttempt = 0
    const controller = createBoundedReconnectRepair({
      load: async () => {
        await gate.promise
        return true
      },
      arm: () => {
        flag.armed = true
      },
      disarm: () => {
        flag.armed = false
        lateSuccessDisarmed.resolve()
      },
      timeoutMs: 5,
      createDeadline: deadlines.createDeadline,
      onAttemptTimeout: (attempt) => {
        timedOutAttempt = attempt
      },
    })

    const run = controller.run()
    deadlines.elapse()
    await expect(run).resolves.toBe('timed-out')
    // Re-armed on the deadline, not on a redundant success further down the line.
    expect(flag.armed).toBe(true)
    expect(timedOutAttempt).toBe(1)
    // The guard is held until the timed-out load settles, so a reconnect during the
    // gap joins it rather than starting a second concurrent load.
    expect(controller.inFlight).toBe(true)
    await expect(controller.run()).resolves.toBe('in-flight')

    gate.resolve()
    await lateSuccessDisarmed.promise
    await flushMicrotasks()
    expect(flag.armed).toBe(false)
    expect(controller.inFlight).toBe(false)
  })

  it('keeps the flag armed when the late load fails after the deadline', async () => {
    const flag = createFlag()
    const deadlines = createManualDeadlines()
    const gate = Promise.withResolvers<void>()
    const controller = createBoundedReconnectRepair({
      load: async () => {
        await gate.promise
        return false
      },
      arm: () => {
        flag.armed = true
      },
      disarm: () => {
        flag.armed = false
      },
      timeoutMs: 5,
      createDeadline: deadlines.createDeadline,
    })

    const run = controller.run()
    deadlines.elapse()
    await expect(run).resolves.toBe('timed-out')
    expect(flag.armed).toBe(true)

    gate.resolve()
    await flushMicrotasks(6)
    expect(flag.armed).toBe(true)
  })
})
