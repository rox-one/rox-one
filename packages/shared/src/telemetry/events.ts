/**
 * Product-analytics event catalogue + `track` facade.
 *
 * Transport lives in `./posthog.ts` (capture + feature flags) and `./otel.ts`
 * (OTLP traces); `./index.ts` wires them into a single sink. This module is
 * intentionally process-agnostic: it never reads env, never imports `electron`
 * and never touches the network itself.
 *
 * Until `initTelemetry()` installs a sink — or whenever the user's
 * «Аналитика продукта» consent is off, or the endpoints are unset — every call
 * here is a silent no-op. Analytics must never break (or block) the app.
 *
 * ## Naming contract
 *
 * The registration funnel names below are a contract with the PostHog side; do
 * not rename without a server-side migration. They are emitted in order:
 *
 * ```text
 * registration_started
 *   → onboarding_step_viewed    { step: 'username' }
 *   → onboarding_step_completed { step: 'username' }
 *   → onboarding_username_checked { available }
 *   → onboarding_step_viewed    { step: 'profile' }
 *   → onboarding_step_completed { step: 'profile' }
 *   → onboarding_step_viewed    { step: 'permissions' }
 *   → onboarding_step_completed { step: 'permissions' }
 *   → onboarding_coins_viewed
 *   → onboarding_telegram_linked | onboarding_github_linked
 *   → registration_completed
 * ```
 *
 * `step` values mirror the onboarding wizard steps (`welcome`, `username`,
 * `profile`, `permissions`, `finish`) plus `provider-select` for the
 * Settings → ИИ setup flow.
 *
 * ## Redaction
 *
 * `sanitizeTelemetryProps()` is applied to every event and span before it
 * leaves the process: keys that look sensitive (tokens, secrets, credentials,
 * emails, message/prompt content, file names) are dropped, and string values
 * that look like emails, absolute file paths, or opaque tokens are replaced
 * with `[redacted]`. File paths, tokens, message contents and emails must never
 * reach PostHog or an OTLP collector.
 */

/** Scalar attribute value accepted by both transports. */
export type TelemetryAttributeValue = string | number | boolean

/** Props for an event with no meaningful payload. */
export type TelemetryEmptyProps = Record<string, never>

/**
 * Catalogue of product events and their props. Add new events here so `track`
 * stays typed; keep names snake_case and (for onboarding) prefixed.
 */
export interface TelemetryEventMap {
  /** Onboarding wizard step became visible. */
  onboarding_step_viewed: { step: string }
  /** Onboarding wizard step finished (fully or deferred). */
  onboarding_step_completed: { step: string; deferred?: boolean }
  /** Username availability probe returned (availability only — never the name). */
  onboarding_username_checked: { available: boolean; reason?: string }
  /** Rox-coins surface viewed during onboarding. */
  onboarding_coins_viewed: { balance?: number; pending?: number }
  /** Telegram account linked to the Rox account. */
  onboarding_telegram_linked: TelemetryEmptyProps
  /** GitHub account linked to the Rox account. */
  onboarding_github_linked: TelemetryEmptyProps
  /** First step of the registration funnel. */
  registration_started: TelemetryEmptyProps
  /** Terminal step of the registration funnel. */
  registration_completed: TelemetryEmptyProps
  /** Process/window came up. */
  app_opened: { platform: string; version?: string }
}

export type TelemetryEventName = keyof TelemetryEventMap

/**
 * Ordered registration funnel (documented in the module comment above).
 * Exported so callers/tests can assert ordering without duplicating strings.
 */
export const REGISTRATION_FUNNEL: readonly TelemetryEventName[] = [
  'registration_started',
  'onboarding_step_viewed',
  'onboarding_step_completed',
  'onboarding_username_checked',
  'onboarding_coins_viewed',
  'onboarding_telegram_linked',
  'onboarding_github_linked',
  'registration_completed',
] as const

/** A live trace span. `end()` is idempotent. */
export interface TelemetrySpan {
  end(attributes?: Record<string, TelemetryAttributeValue>): void
}

/** Sink installed by `initTelemetry()`; the facade only delegates to it. */
export interface TelemetrySink {
  track(event: string, props: Record<string, unknown>): void
  getFeatureFlag(key: string): Promise<boolean | string | undefined>
  trace(
    name: string,
    attributes?: Record<string, TelemetryAttributeValue>,
  ): TelemetrySpan | undefined
}

const NOOP_SPAN: TelemetrySpan = { end() {} }

let activeSink: TelemetrySink | null = null

/** Install (or clear with `null`) the process-wide telemetry sink. */
export function setTelemetrySink(sink: TelemetrySink | null): void {
  activeSink = sink
}

/** Current sink, for tests and `dispose()` bookkeeping. */
export function getTelemetrySink(): TelemetrySink | null {
  return activeSink
}

/**
 * Track a product event. No-op when no sink is installed, when consent is off,
 * or when the endpoints are unset; never throws.
 */
export function track<K extends TelemetryEventName>(
  event: K,
  ...props: TelemetryEventMap[K] extends TelemetryEmptyProps
    ? [props?: TelemetryEventMap[K]]
    : [props: TelemetryEventMap[K]]
): void {
  const sink = activeSink
  if (!sink) return
  try {
    sink.track(event, sanitizeTelemetryProps(props[0] as Record<string, unknown> | undefined))
  } catch {
    /* analytics is best-effort and must never break the caller */
  }
}

/**
 * Resolve a feature flag. Returns `undefined` when telemetry is off, consent is
 * withheld, or the flag is unknown; never throws.
 */
export async function getFeatureFlag(key: string): Promise<boolean | string | undefined> {
  const sink = activeSink
  if (!sink) return undefined
  try {
    return await sink.getFeatureFlag(key)
  } catch {
    return undefined
  }
}

/**
 * Open a trace span. Returns a no-op span when telemetry is off so callers can
 * `trace(...).end()` unconditionally.
 */
export function trace(
  name: string,
  attributes?: Record<string, TelemetryAttributeValue>,
): TelemetrySpan {
  const sink = activeSink
  if (!sink) return NOOP_SPAN
  try {
    return sink.trace(name, attributes) ?? NOOP_SPAN
  } catch {
    return NOOP_SPAN
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Attribute keys that must never leave the process. */
const SENSITIVE_KEY_PATTERN =
  /(pass(word|phrase)?|secret|token|api[_-]?key|authorization|bearer|cookie|credential|email|e[-_]?mail|message|content|prompt|transcript|filepath|file_path|file_name|filename|private[_-]?key|access[_-]?key|session[_-]?id|dsn)/i

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const MAX_STRING_LENGTH = 512
const MAX_DEPTH = 3
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 50

export const REDACTED = '[redacted]'

/** Absolute/unix/home/drive/file-URL paths. */
function looksLikeFilePath(value: string): boolean {
  if (value.startsWith('~/') || value.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  if (value.startsWith('file://')) return true
  return value.includes('\\Users\\') || value.includes('\\home\\')
}

/** Opaque credentials: JWTs, base64url/hex blobs, long opaque strings. */
function looksLikeToken(value: string): boolean {
  if (value.length < 32) return false
  return /^[A-Za-z0-9_\-./+=]+$/.test(value)
}

function sanitizeString(value: string): string {
  if (value.length > MAX_STRING_LENGTH) return REDACTED
  if (EMAIL_PATTERN.test(value)) return REDACTED
  if (looksLikeFilePath(value)) return REDACTED
  if (looksLikeToken(value)) return REDACTED
  return value
}

/** Recursively drop sensitive keys and redact sensitive-looking values. */
export function sanitizeTelemetryProps(
  input: Record<string, unknown> | undefined,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object') return out
  let keys = 0
  for (const [key, value] of Object.entries(input)) {
    if (keys >= MAX_OBJECT_KEYS) break
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    const sanitized = sanitizeTelemetryValue(value, depth)
    if (sanitized === undefined) continue
    out[key] = sanitized
    keys += 1
  }
  return out
}

function sanitizeTelemetryValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (value === null) return null
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return undefined
    const items: unknown[] = []
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      const sanitized = sanitizeTelemetryValue(item, depth + 1)
      if (sanitized !== undefined) items.push(sanitized)
    }
    return items
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return undefined
    return sanitizeTelemetryProps(value as Record<string, unknown>, depth + 1)
  }
  // functions, symbols, bigints, undefined: never serialized
  return undefined
}