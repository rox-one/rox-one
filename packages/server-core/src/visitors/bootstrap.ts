/**
 * Visitor-access bootstrap (port-matrix row a1.6).
 *
 * Called once at server start. Registration is CONFIG-GATED and fail-closed:
 *
 *  - visitor config present  → build the grant store + service, register the
 *    `visitor-access` plugin, and schedule the hourly sweep on the host
 *    scheduler;
 *  - visitor config absent (or `enabled: false`) → register NOTHING and return
 *    `service: null`. A role that still names `visitor-access` keeps being
 *    refused with the typed OPERATOR_ACCESS_DENIED — the wave-4 fail-closed
 *    default is unchanged.
 *
 * The function is dependency-injected (registrar, scheduler, clock) so the
 * bootstrap contract is testable without a live server.
 */
import { registerAccessPolicyPlugin, type AccessPolicyPlugin } from '../authority/access-policy-registry.ts'
import { VisitorGrantStore } from './grant-store.ts'
import { createVisitorProvider } from './provider.ts'
import { VisitorAccessService, VISITOR_ACCESS_PLUGIN_NAME } from './service.ts'

/** Subset of `StoredConfig.visitors` this module consumes. */
export interface VisitorAccessConfig {
  enabled?: boolean
  /** Provider id, e.g. `cloudflare-access`. */
  provider?: string
  /** Grant lifetime in days (default 14). */
  grantTtlDays?: number
  /** Sweep cadence in minutes (default 60). */
  sweepIntervalMinutes?: number
}

/** The slice of the host scheduler this module needs. */
export interface VisitorSweepScheduler {
  scheduleEvery(params: {
    id: string
    everyMs: number
    run: () => void | Promise<void>
  }): { stop(): Promise<void>; cancel(): void }
}

export interface ConfigureVisitorAccessDeps {
  /** Loaded global config; only `visitors` is read. */
  config: { visitors?: VisitorAccessConfig } | null | undefined
  scheduler: VisitorSweepScheduler
  /** Registrar override (tests). Defaults to the real plugin registry. */
  register?: (name: string, plugin: AccessPolicyPlugin) => void
  /** Injected clock (tests). */
  now?: () => number
  log?: (message: string) => void
}

export interface VisitorAccessRuntime {
  /** The live service, or null when visitor config is absent. */
  service: VisitorAccessService | null
  /** Whether the `visitor-access` plugin was registered. */
  pluginRegistered: boolean
  /** Stop the sweep and dispose the store (idempotent). */
  dispose: () => Promise<void>
}

const IDLE_RUNTIME: VisitorAccessRuntime = {
  service: null,
  pluginRegistered: false,
  dispose: async () => {},
}

export function configureVisitorAccess(deps: ConfigureVisitorAccessDeps): VisitorAccessRuntime {
  const config = deps.config?.visitors
  if (!config || config.enabled === false) return IDLE_RUNTIME

  const ttlMs = (config.grantTtlDays ?? 14) * 24 * 60 * 60_000
  const sweepMs = (config.sweepIntervalMinutes ?? 60) * 60_000
  const store = new VisitorGrantStore({
    ...(deps.now ? { now: deps.now } : {}),
    ttlMs,
    sweepIntervalMs: sweepMs,
    // The host scheduler owns the periodic sweep (one timer owner); the store
    // keeps only its nearest-expiry timer.
    periodicSweep: false,
  })
  const provider = config.provider ? createVisitorProvider({ provider: config.provider }) : undefined
  const service = new VisitorAccessService({
    store,
    ...(provider ? { provider } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  })

  const register = deps.register ?? registerAccessPolicyPlugin
  register(VISITOR_ACCESS_PLUGIN_NAME, service.buildPlugin())

  const sweep = deps.scheduler.scheduleEvery({
    id: 'visitors.sweep',
    everyMs: sweepMs,
    run: () => {
      const removed = store.sweep()
      if (removed.length > 0) deps.log?.(`swept ${removed.length} expired visitor grant(s)`)
    },
  })

  deps.log?.(
    `visitor access enabled (plugin "${VISITOR_ACCESS_PLUGIN_NAME}", TTL ${config.grantTtlDays ?? 14}d, sweep ${config.sweepIntervalMinutes ?? 60}m)`,
  )

  let disposed = false
  return {
    service,
    pluginRegistered: true,
    dispose: async () => {
      if (disposed) return
      disposed = true
      await sweep.stop()
      store.dispose()
    },
  }
}