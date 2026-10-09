/**
 * Dependency-free PostHog client (capture + feature flags).
 *
 * Uses global `fetch` (injectable for tests) — no PostHog SDK, no new npm deps.
 * The client is intentionally non-blocking: a background timer flushes the
 * buffer, timers are `unref()`ed so they never hold the process open, and every
 * network path is wrapped so failures can never reject into the caller.
 *
 * Capture: batches events and POSTs `{POSTHOG_HOST}/batch/`.
 * Flags:   POSTs `{POSTHOG_HOST}/decide/?v=3` with a 5-minute cache plus a local
 *          fallback map; a non-200 (or network error) engages a kill switch so
 *          a broken/absent `/decide` endpoint never gets hammered.
 */

import { sanitizeTelemetryProps } from './events.ts'

const DEFAULT_FLUSH_INTERVAL_MS = 10_000
const DEFAULT_MAX_BATCH_SIZE = 20
const DEFAULT_MAX_BUFFER_SIZE = 200
const DEFAULT_FLAG_TTL_MS = 5 * 60_000
const DEFAULT_FLAG_KILL_SWITCH_MS = 5 * 60_000
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

export interface PostHogBatchEvent {
  event: string
  distinct_id: string
  properties: Record<string, unknown>
  timestamp: string
}

export interface PostHogClientOptions {
  /** Base host, e.g. `https://posthog.rox.one` (trailing slashes tolerated). */
  host: string
  apiKey: string
  distinctId: string
  /** `$lib` tag attached to every event. */
  lib?: string
  fetchImpl?: typeof fetch
  now?: () => number
  flushIntervalMs?: number
  /** Flush as soon as this many events are buffered. */
  maxBatchSize?: number
  /** Drop-oldest cap on the pending buffer. */
  maxBufferSize?: number
  flagCacheTtlMs?: number
  flagKillSwitchMs?: number
  /** Hard env kill switch: when false, `/decide` is never fetched. */
  flagsEnabled?: boolean
  /** Values returned when `/decide` is unavailable. */
  fallbackFlags?: Record<string, boolean | string>
  /** Renderer unload path; e.g. `navigator.sendBeacon(url, blob)`. */
  sendBeaconImpl?: (url: string, data: string) => boolean
  onError?: (error: unknown) => void
}

export class PostHogClient {
  readonly #host: string
  readonly #apiKey: string
  readonly #distinctId: string
  readonly #lib: string
  readonly #fetch: typeof fetch | undefined
  readonly #now: () => number
  readonly #flushIntervalMs: number
  readonly #maxBatchSize: number
  readonly #maxBufferSize: number
  readonly #flagCacheTtlMs: number
  readonly #flagKillSwitchMs: number
  readonly #flagsEnabled: boolean
  readonly #fallbackFlags: Record<string, boolean | string>
  readonly #sendBeacon: ((url: string, data: string) => boolean) | undefined
  readonly #onError: ((error: unknown) => void) | undefined

  #buffer: PostHogBatchEvent[] = []
  #timer: ReturnType<typeof setInterval> | null = null
  #inFlight: Promise<boolean> | null = null
  #flagCache = new Map<string, { value: boolean | string; expiresAt: number }>()
  #flagsDisabledUntil = 0

  constructor(options: PostHogClientOptions) {
    this.#host = trimTrailingSlash(options.host)
    this.#apiKey = options.apiKey
    this.#distinctId = options.distinctId
    this.#lib = options.lib ?? 'rox-desktop'
    this.#fetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)
    this.#now = options.now ?? Date.now
    this.#flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    this.#maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
    this.#maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE
    this.#flagCacheTtlMs = options.flagCacheTtlMs ?? DEFAULT_FLAG_TTL_MS
    this.#flagKillSwitchMs = options.flagKillSwitchMs ?? DEFAULT_FLAG_KILL_SWITCH_MS
    this.#flagsEnabled = options.flagsEnabled !== false
    this.#fallbackFlags = options.fallbackFlags ?? {}
    this.#sendBeacon = options.sendBeaconImpl
    this.#onError = options.onError
  }

  /** Capture needs both a host and a key; otherwise the client is inert. */
  get enabled(): boolean {
    return this.#host.length > 0 && this.#apiKey.length > 0 && typeof this.#fetch === 'function'
  }

  /** Start the periodic flush timer (idempotent). */
  start(): void {
    if (this.#timer || !this.enabled) return
    this.#timer = setInterval(() => {
      void this.flush()
    }, this.#flushIntervalMs)
    this.#timer.unref?.()
  }

  /** Stop the periodic flush timer; buffered events stay until the next flush. */
  stop(): void {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = null
  }

  /** Enqueue an event; flushes immediately once `maxBatchSize` is reached. */
  capture(event: string, props: Record<string, unknown> = {}): void {
    if (!this.enabled) return
    if (this.#buffer.length >= this.#maxBufferSize) this.#buffer.shift()
    this.#buffer.push({
      event,
      distinct_id: this.#distinctId,
      properties: { $lib: this.#lib, ...sanitizeTelemetryProps(props) },
      timestamp: new Date(this.#now()).toISOString(),
    })
    if (this.#buffer.length >= this.#maxBatchSize) void this.flush()
  }

  /**
   * Send all buffered events. One retry maximum; events are re-queued (bounded)
   * if both attempts fail. Never rejects.
   */
  async flush(): Promise<boolean> {
    if (this.#inFlight) return this.#inFlight
    if (!this.enabled || this.#buffer.length === 0) return true
    const events = this.#buffer.splice(0, this.#buffer.length)
    const run = this.#sendBatch(events)
    this.#inFlight = run
    try {
      const ok = await run
      if (!ok) this.#requeue(events)
      return ok
    } finally {
      this.#inFlight = null
    }
  }

  /**
   * Unload path for browsers/Electron renderers: send everything via
   * `sendBeacon` (which survives page teardown, unlike `fetch`). Returns false
   * when there is nothing to send or no beacon available.
   */
  flushWithBeacon(): boolean {
    if (!this.enabled || this.#buffer.length === 0 || !this.#sendBeacon) return false
    const events = this.#buffer.splice(0, this.#buffer.length)
    let ok = false
    try {
      ok = this.#sendBeacon(this.#url('/batch/'), JSON.stringify({ api_key: this.#apiKey, batch: events }))
    } catch (error) {
      this.#onError?.(error)
    }
    if (!ok) this.#requeue(events)
    return ok
  }

  /**
   * Resolve a feature flag, cached for `flagCacheTtlMs` with a local fallback.
   * When the env kill switch is engaged (`flagsEnabled: false`) no request is
   * ever made and the local fallback map answers instead.
   */
  async getFlag(key: string): Promise<boolean | string | undefined> {
    if (!this.enabled || !this.#flagsEnabled) return this.#fallbackFlags[key]
    const now = this.#now()
    const cached = this.#flagCache.get(key)
    if (cached && now < cached.expiresAt) return cached.value
    if (now < this.#flagsDisabledUntil) return this.#fallbackFlags[key]
    const flags = await this.#fetchDecide()
    if (!flags) {
      // Non-200 / network error → kill switch until the cooldown elapses.
      this.#flagsDisabledUntil = now + this.#flagKillSwitchMs
      return this.#fallbackFlags[key]
    }
    const expiresAt = now + this.#flagCacheTtlMs
    for (const [name, value] of Object.entries(flags)) {
      this.#flagCache.set(name, { value, expiresAt })
    }
    return this.#flagCache.get(key)?.value ?? this.#fallbackFlags[key]
  }

  async #sendBatch(events: PostHogBatchEvent[]): Promise<boolean> {
    const body = JSON.stringify({ api_key: this.#apiKey, batch: events })
    const url = this.#url('/batch/')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.#request(url, body)
        if (response.ok) return true
      } catch (error) {
        this.#onError?.(error)
      }
    }
    return false
  }

  async #fetchDecide(): Promise<Record<string, boolean | string> | null> {
    try {
      const body = JSON.stringify({ api_key: this.#apiKey, distinct_id: this.#distinctId })
      const response = await this.#request(this.#url('/decide/?v=3'), body)
      if (!response.ok) return null
      const data = (await response.json()) as { featureFlags?: unknown }
      return normalizeDecideFlags(data?.featureFlags)
    } catch (error) {
      this.#onError?.(error)
      return null
    }
  }

  async #request(url: string, body: string): Promise<Response> {
    const fetchImpl = this.#fetch
    if (!fetchImpl) throw new Error('fetch unavailable')
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller
      ? setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)
      : null
    timer?.unref?.()
    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        ...(controller ? { signal: controller.signal } : {}),
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  #requeue(events: PostHogBatchEvent[]): void {
    this.#buffer = [...events, ...this.#buffer]
    while (this.#buffer.length > this.#maxBufferSize) this.#buffer.shift()
  }

  #url(path: string): string {
    return `${this.#host}${path}`
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/** Accepts both the `{key: value}` map and the legacy `string[]` flag shapes. */
function normalizeDecideFlags(raw: unknown): Record<string, boolean | string> {
  const out: Record<string, boolean | string> = {}
  if (Array.isArray(raw)) {
    for (const value of raw) if (typeof value === 'string' && value) out[value] = true
    return out
  }
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'boolean' || (typeof value === 'string' && value)) out[key] = value
    }
  }
  return out
}