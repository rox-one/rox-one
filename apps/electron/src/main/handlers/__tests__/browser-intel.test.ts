/**
 * Tests for the Browser Intelligence Pipeline handlers.
 *
 * Harness shape mirrors siyuan.test.ts / browser-broadcast.test.ts: recorder
 * RpcServer + minimal HandlerDeps. The runtime module (`../browser-intel/index`)
 * is mocked before the handler is dynamically imported, so no real DB, timer or
 * pipeline is ever touched. The contract under test is the thin registry: the
 * six local-only channels delegate to the runtime snapshots, the mutating
 * handlers broadcast STATE_CHANGED, and the single process-global subscription
 * forwards progress/state events to the right push channels.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { RpcServer } from '@rox/server-core/transport'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type {
  BrowserIntelState,
  IntelligenceStats,
  PipelineProgress,
  ProfileSlotRecord,
} from '@rox/browser-intel'
import type { HandlerDeps } from '../handler-deps'

import { electronMockExports } from '../../__tests__/electron-mock-exports'

mock.module('electron', () => ({
  ...electronMockExports,
  ipcMain: { handle: () => {}, on: () => {} },
}))

function makeState(overrides: Partial<BrowserIntelState> = {}): BrowserIntelState {
  return {
    consent: true,
    consentAt: 1_700_000_000_000,
    lastRunAt: null,
    lastResult: null,
    error: null,
    revision: 7,
    ...overrides,
  }
}

const EMPTY_STATS: IntelligenceStats = {
  profiles: 0,
  profilesByVendor: [],
  urls: 0,
  urlsPending: 0,
  urlsUnfurled: 0,
  urlsFailed: 0,
  visits: 0,
  bookmarks: 0,
  searches: 0,
  firstVisitAt: null,
  lastVisitAt: null,
  unfurlDetails: 0,
  slots: 0,
  dbBytes: null,
  lastIngestAt: null,
  lastUnfurlAt: null,
}

type BrowserIntelEvent =
  | { type: 'progress'; progress: PipelineProgress }
  | { type: 'state'; state: BrowserIntelState }

// Mutable seams read lazily by the mocked runtime factory below.
let stateSnapshot: BrowserIntelState = makeState()
let statsSnapshot: IntelligenceStats = EMPTY_STATS
let slotsSnapshot: ProfileSlotRecord[] = []
let consentResult: BrowserIntelState = makeState()
const consentCalls: unknown[] = []
let startResult: { started: boolean } = { started: true }
let cancelResult: { cancelled: boolean } = { cancelled: true }
const eventListeners = new Set<(event: BrowserIntelEvent) => void>()

mock.module('../../browser-intel/index.ts', () => ({
  onBrowserIntelEvent: (listener: (event: BrowserIntelEvent) => void) => {
    eventListeners.add(listener)
    return () => {
      eventListeners.delete(listener)
    }
  },
  getBrowserIntelStateSnapshot: () => stateSnapshot,
  getBrowserIntelStatsSnapshot: () => statsSnapshot,
  getBrowserIntelSlotsSnapshot: () => slotsSnapshot,
  setBrowserIntelConsentAndSync: async (consent: boolean) => {
    consentCalls.push(consent)
    return consentResult
  },
  startBrowserIntelRun: () => startResult,
  cancelBrowserIntelRun: () => cancelResult,
}))

function emitEvent(event: BrowserIntelEvent): void {
  for (const listener of [...eventListeners]) listener(event)
}

type HandlerFn = (...args: unknown[]) => unknown
type Push = { channel: string; target: unknown; args: unknown[] }

interface Recorder {
  server: RpcServer
  handlers: Map<string, HandlerFn>
  options: Map<string, unknown>
  pushes: Push[]
}

function makeServer(): Recorder {
  const handlers = new Map<string, HandlerFn>()
  const options = new Map<string, unknown>()
  const pushes: Push[] = []
  const server: RpcServer = {
    handle(channel, handler, opts) {
      handlers.set(channel, handler as HandlerFn)
      options.set(channel, opts)
    },
    push(channel, target, ...args) {
      pushes.push({ channel, target, args })
    },
    async invokeClient() {},
    hasClientCapability() {
      return false
    },
    findClientsWithCapability() {
      return []
    },
  }
  return { server, handlers, options, pushes }
}

const DEPS = {} as HandlerDeps
const CTX = {} as never

describe('browser-intel handlers', () => {
  let recorder: Recorder
  let register: (server: RpcServer, deps: HandlerDeps) => void
  let HANDLED_CHANNELS: readonly string[]

  beforeEach(async () => {
    recorder = makeServer()
    consentCalls.length = 0
    eventListeners.clear()
    stateSnapshot = makeState()
    statsSnapshot = EMPTY_STATS
    slotsSnapshot = []
    consentResult = makeState()
    startResult = { started: true }
    cancelResult = { cancelled: true }

    // Dynamic import: the runtime module must be mocked before the handler
    // module graph resolves (repo-wide convention across main/handlers tests).
    const mod = await import('../browser-intel')
    register = mod.registerBrowserIntelHandlers
    HANDLED_CHANNELS = mod.HANDLED_CHANNELS
  })

  it('declares exactly the six invoke channels — pushes are handler-external', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.browserIntel.GET_STATE,
      RPC_CHANNELS.browserIntel.SET_CONSENT,
      RPC_CHANNELS.browserIntel.GET_STATS,
      RPC_CHANNELS.browserIntel.GET_SLOTS,
      RPC_CHANNELS.browserIntel.START_RUN,
      RPC_CHANNELS.browserIntel.CANCEL_RUN,
    ])
    expect([...HANDLED_CHANNELS]).not.toContain(RPC_CHANNELS.browserIntel.PROGRESS)
    expect([...HANDLED_CHANNELS]).not.toContain(RPC_CHANNELS.browserIntel.STATE_CHANGED)
  })

  it('registers a handler for every declared channel and nothing else', () => {
    register(recorder.server, DEPS)

    expect(recorder.handlers.size).toBe(HANDLED_CHANNELS.length)
    expect([...recorder.handlers.keys()].sort()).toEqual([...HANDLED_CHANNELS].sort())
    for (const channel of HANDLED_CHANNELS) {
      expect(recorder.options.get(channel)).toMatchObject({ access: 'localElectron' })
    }
  })

  it('GET_STATE / GET_STATS / GET_SLOTS delegate to the runtime snapshots', () => {
    register(recorder.server, DEPS)

    expect(recorder.handlers.get(RPC_CHANNELS.browserIntel.GET_STATE)!(CTX)).toBe(stateSnapshot)

    expect(recorder.handlers.get(RPC_CHANNELS.browserIntel.GET_STATS)!(CTX)).toBe(statsSnapshot)

    expect(recorder.handlers.get(RPC_CHANNELS.browserIntel.GET_SLOTS)!(CTX)).toBe(slotsSnapshot)
  })

  it('SET_CONSENT coerces non-boolean input to false and broadcasts the resulting state', async () => {
    register(recorder.server, DEPS)
    const handler = recorder.handlers.get(RPC_CHANNELS.browserIntel.SET_CONSENT)!

    const result = await handler(CTX, 'yes' as never)

    expect(consentCalls).toEqual([false])
    expect(result).toBe(consentResult)

    const pushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.browserIntel.STATE_CHANGED)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].target).toEqual({ to: 'all' })
    expect(pushes[0].args).toEqual([consentResult])
  })

  it('SET_CONSENT forwards a true boolean verbatim', async () => {
    register(recorder.server, DEPS)
    const handler = recorder.handlers.get(RPC_CHANNELS.browserIntel.SET_CONSENT)!

    await handler(CTX, true)

    expect(consentCalls).toEqual([true])
  })

  it('START_RUN delegates, returns its result and broadcasts the latest state', () => {
    register(recorder.server, DEPS)
    const handler = recorder.handlers.get(RPC_CHANNELS.browserIntel.START_RUN)!

    const result = handler(CTX)

    expect(result).toBe(startResult)
    const pushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.browserIntel.STATE_CHANGED)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].target).toEqual({ to: 'all' })
    expect(pushes[0].args).toEqual([stateSnapshot])
  })

  it('CANCEL_RUN delegates, returns its result and broadcasts the latest state', () => {
    register(recorder.server, DEPS)
    const handler = recorder.handlers.get(RPC_CHANNELS.browserIntel.CANCEL_RUN)!

    const result = handler(CTX)

    expect(result).toBe(cancelResult)
    const pushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.browserIntel.STATE_CHANGED)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].target).toEqual({ to: 'all' })
    expect(pushes[0].args).toEqual([stateSnapshot])
  })

  it('forwards runtime progress events as PROGRESS pushes and state events as STATE_CHANGED', () => {
    register(recorder.server, DEPS)

    const progress: PipelineProgress = {
      stage: 'unfurl',
      message: 'Unfurling URLs',
      current: 3,
      total: 10,
      startedAt: 1_700_000_000_000,
    }
    const nextState = makeState({ revision: 8 })
    emitEvent({ type: 'progress', progress })
    emitEvent({ type: 'state', state: nextState })

    const progressPushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.browserIntel.PROGRESS)
    expect(progressPushes).toHaveLength(1)
    expect(progressPushes[0].target).toEqual({ to: 'all' })
    expect(progressPushes[0].args).toEqual([progress])

    const statePushes = recorder.pushes.filter((p) => p.channel === RPC_CHANNELS.browserIntel.STATE_CHANGED)
    expect(statePushes).toHaveLength(1)
    expect(statePushes[0].target).toEqual({ to: 'all' })
    expect(statePushes[0].args).toEqual([nextState])
  })
})