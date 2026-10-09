/**
 * Dependency-free OpenTelemetry OTLP/HTTP JSON client (traces only).
 *
 * Posts `resourceSpans` payloads to `{OTEL_TRACES_URL}/v1/traces` using global
 * `fetch` (injectable for tests). Fire-and-forget: spans are buffered (drop
 * oldest past 100), coalesced into one request, sent with a 2 s abort timeout,
 * and every failure is swallowed — tracing never blocks or breaks the app.
 */

import { sanitizeTelemetryProps, type TelemetryAttributeValue } from './events.ts'

const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_MAX_BUFFER_SIZE = 100
const DEFAULT_SERVICE_NAME = 'rox-desktop'

/** OTLP span kind; 1 = INTERNAL (no server span semantics here). */
const SPAN_KIND_INTERNAL = 1

export interface OtelResource {
  serviceName: string
  serviceVersion?: string
  platform?: string
}

export interface OtelSpan {
  name: string
  traceId: string
  spanId: string
  startTimeMs: number
  endTimeMs: number
  attributes?: Record<string, TelemetryAttributeValue>
  /** Maps to OTLP `status.code` (1 = OK, 2 = ERROR, 0 = unset). */
  status?: 'unset' | 'ok' | 'error'
}

export interface OtelSpanHandle {
  readonly traceId: string
  readonly spanId: string
  /** Finish the span and enqueue it. Idempotent. */
  end(attributes?: Record<string, TelemetryAttributeValue>): void
}

interface OtelAttribute {
  key: string
  value: Record<string, unknown>
}

interface OtelSpanPayload {
  traceId: string
  spanId: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtelAttribute[]
  status: { code: number }
}

export interface OtelPayload {
  resourceSpans: Array<{
    resource: { attributes: OtelAttribute[] }
    scopeSpans: Array<{ scope: { name: string }; spans: OtelSpanPayload[] }>
  }>
}

export interface OtelClientOptions {
  /** Base URL, e.g. `https://otel.rox.one` (trailing slashes tolerated). */
  endpoint: string
  serviceName?: string
  serviceVersion?: string
  platform?: string
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
  maxBufferSize?: number
  randomHex?: (bytes: number) => string
  onError?: (error: unknown) => void
}

export class OtelClient {
  readonly #endpoint: string
  readonly #resource: OtelResource
  readonly #fetch: typeof fetch | undefined
  readonly #now: () => number
  readonly #timeoutMs: number
  readonly #maxBufferSize: number
  readonly #randomHex: (bytes: number) => string
  readonly #onError: ((error: unknown) => void) | undefined

  #buffer: OtelSpan[] = []
  #scheduled: ReturnType<typeof setTimeout> | null = null
  #inFlight = false

  constructor(options: OtelClientOptions) {
    this.#endpoint = options.endpoint.replace(/\/+$/, '')
    this.#resource = {
      serviceName: options.serviceName ?? DEFAULT_SERVICE_NAME,
      serviceVersion: options.serviceVersion,
      platform: options.platform,
    }
    this.#fetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)
    this.#now = options.now ?? Date.now
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE
    this.#randomHex = options.randomHex ?? defaultRandomHex
    this.#onError = options.onError
  }

  get enabled(): boolean {
    return this.#endpoint.length > 0 && typeof this.#fetch === 'function'
  }

  get resource(): OtelResource {
    return this.#resource
  }

  /**
   * Start a span. `end()` stamps the finish time (and merges extra attributes)
   * then records it. A disabled client returns a no-op handle.
   */
  startSpan(
    name: string,
    attributes?: Record<string, TelemetryAttributeValue>,
  ): OtelSpanHandle {
    if (!this.enabled) return { traceId: '', spanId: '', end() {} }
    const traceId = this.#randomHex(16)
    const spanId = this.#randomHex(8)
    const startTimeMs = this.#now()
    let ended = false
    return {
      traceId,
      spanId,
      end: (extra) => {
        if (ended) return
        ended = true
        this.recordSpan({
          name,
          traceId,
          spanId,
          startTimeMs,
          endTimeMs: this.#now(),
          attributes: { ...attributes, ...extra },
        })
      },
    }
  }

  /** Complete a span and enqueue it for the next coalesced flush. */
  recordSpan(span: OtelSpan): void {
    if (!this.enabled) return
    if (this.#buffer.length >= this.#maxBufferSize) this.#buffer.shift()
    this.#buffer.push(span)
    this.#scheduleFlush()
  }

  /** Send all buffered spans as one OTLP request. Never rejects. */
  async flush(): Promise<void> {
    if (this.#inFlight || this.#buffer.length === 0) return
    if (!this.enabled) {
      this.#buffer = []
      return
    }
    this.#inFlight = true
    const spans = this.#buffer.splice(0, this.#buffer.length)
    try {
      await this.#send(spans)
    } finally {
      this.#inFlight = false
    }
  }

  /** Cancel the coalescing timer. Buffered spans stay until the next flush. */
  stop(): void {
    if (this.#scheduled) {
      clearTimeout(this.#scheduled)
      this.#scheduled = null
    }
  }

  #scheduleFlush(): void {
    if (this.#scheduled) return
    this.#scheduled = setTimeout(() => {
      this.#scheduled = null
      void this.flush()
    }, 0)
    this.#scheduled.unref?.()
  }

  async #send(spans: OtelSpan[]): Promise<void> {
    const fetchImpl = this.#fetch
    if (!fetchImpl) return
    const payload = buildOtlpPayload(spans, this.#resource)
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), this.#timeoutMs) : null
    timer?.unref?.()
    try {
      await fetchImpl(`${this.#endpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      })
    } catch (error) {
      this.#onError?.(error)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/** Build a spec-shaped OTLP/HTTP JSON trace payload. Exported for tests. */
export function buildOtlpPayload(spans: OtelSpan[], resource: OtelResource): OtelPayload {
  const resourceAttributes: Record<string, TelemetryAttributeValue> = {
    'service.name': resource.serviceName,
  }
  if (resource.serviceVersion) resourceAttributes['service.version'] = resource.serviceVersion
  if (resource.platform) resourceAttributes['service.platform'] = resource.platform

  return {
    resourceSpans: [
      {
        resource: { attributes: toOtelAttributes(resourceAttributes) },
        scopeSpans: [
          {
            scope: { name: resource.serviceName },
            spans: spans.map(toOtelSpan),
          },
        ],
      },
    ],
  }
}

function toOtelSpan(span: OtelSpan): OtelSpanPayload {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: unixNano(span.startTimeMs),
    endTimeUnixNano: unixNano(span.endTimeMs),
    attributes: toOtelAttributes(span.attributes),
    status: { code: span.status === 'error' ? 2 : span.status === 'ok' ? 1 : 0 },
  }
}

function toOtelAttributes(
  attributes: Record<string, TelemetryAttributeValue> | undefined,
): OtelAttribute[] {
  const out: OtelAttribute[] = []
  for (const [key, value] of Object.entries(sanitizeTelemetryProps(attributes))) {
    if (typeof value === 'string') out.push({ key, value: { stringValue: value } })
    else if (typeof value === 'boolean') out.push({ key, value: { boolValue: value } })
    else if (typeof value === 'number' && Number.isFinite(value)) {
      out.push({
        key,
        value: Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value },
      })
    }
  }
  return out
}

/** Epoch milliseconds → OTLP nanoseconds, exact even past `Number.MAX_SAFE_INTEGER`. */
function unixNano(timeMs: number): string {
  return (BigInt(Math.round(timeMs)) * 1_000_000n).toString()
}

function defaultRandomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  const webCrypto = globalThis.crypto
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(array)
  else for (let index = 0; index < bytes; index += 1) array[index] = Math.floor(Math.random() * 256)
  let hex = ''
  for (const byte of array) hex += byte.toString(16).padStart(2, '0')
  return hex
}