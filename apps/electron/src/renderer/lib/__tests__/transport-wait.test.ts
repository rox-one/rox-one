import { describe, expect, it } from 'bun:test'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import type { ElectronAPI, TransportConnectionState } from '../../../shared/types'
import { waitForTransportConnected } from '../transport-wait'

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
