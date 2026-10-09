/**
 * Product-analytics entry point: env/config resolution + sink assembly.
 *
 * `initTelemetry()` builds a PostHog capture/flag client and an OTLP trace
 * client from explicit config and installs them as the process-wide sink
 * (see `./events.ts`). It is inert when the endpoints are unset, and every
 * call is additionally gated by the caller-supplied consent getter.
 *
 * Endpoints come from `POSTHOG_HOST` / `POSTHOG_KEY` /
 * `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME`. In the Electron main
 * bundle those are baked at build time (with the self-hosted defaults) via
 * esbuild `--define` (see `scripts/electron-build-main.ts`); the renderer
 * receives the same values from main over `__telemetry-config`.
 * `telemetryConfigFromEnv()` is a pure function so it stays testable and never
 * references a global `process` in renderer bundles.
 */

import {
  getTelemetrySink,
  setTelemetrySink,
  type TelemetryAttributeValue,
  type TelemetrySink,
  type TelemetrySpan,
} from './events.ts'
import { OtelClient } from './otel.ts'
import { PostHogClient } from './posthog.ts'

export * from './events.ts'
export { PostHogClient, type PostHogBatchEvent, type PostHogClientOptions } from './posthog.ts'
export {
  OtelClient,
  buildOtlpPayload,
  type OtelClientOptions,
  type OtelResource,
  type OtelSpan,
} from './otel.ts'

export const DEFAULT_SERVICE_NAME = 'rox-desktop'

export interface TelemetryEndpointConfig {
  posthogHost: string
  posthogApiKey: string
  otelTracesUrl: string
  serviceName: string
}

/** Minimal env shape accepted by `telemetryConfigFromEnv` (string | undefined). */
export type TelemetryEnv = Record<string, string | undefined>

/** Trim whitespace and trailing slashes from a configured URL/host. */
function normalizeUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

/**
 * Resolve endpoint config from an env-like object. Missing `OTEL_SERVICE_NAME`
 * falls back to `rox-desktop`; every other value stays empty when unset, which
 * disables the corresponding client.
 */
export function telemetryConfigFromEnv(env: TelemetryEnv): TelemetryEndpointConfig {
  return {
    posthogHost: normalizeUrl(env.POSTHOG_HOST),
    posthogApiKey: (env.POSTHOG_KEY ?? '').trim(),
    otelTracesUrl: normalizeUrl(env.OTEL_EXPORTER_OTLP_ENDPOINT),
    serviceName: (env.OTEL_SERVICE_NAME ?? '').trim() || DEFAULT_SERVICE_NAME,
  }
}

export interface TelemetryInitOptions extends TelemetryEndpointConfig {
  /** Stable anonymous distinct id (`sha256(hostname + homedir).slice(0, 16)`). */
  distinctId: string
  /** Reads the `gamification` analyticsConsent store; false disables everything. */
  getConsent: () => boolean
  version?: string
  platform?: string
  fetchImpl?: typeof fetch
  /** Renderer unload path (e.g. `navigator.sendBeacon`). */
  sendBeaconImpl?: (url: string, data: string) => boolean
  now?: () => number
  fallbackFlags?: Record<string, boolean | string>
  /** Env kill switch (`POSTHOG_FLAGS_DISABLED=1`): never fetch `/decide`. */
  flagsDisabled?: boolean
  onError?: (error: unknown) => void
}

export interface TelemetryHandle {
  /** True when at least one endpoint is configured (independent of consent). */
  readonly enabled: boolean
  track(event: string, props?: Record<string, unknown>): void
  getFlag(key: string): Promise<boolean | string | undefined>
  trace(name: string, attributes?: Record<string, TelemetryAttributeValue>): TelemetrySpan | undefined
  /** Flush capture + traces. Never rejects. */
  flush(): Promise<void>
  /** Best-effort capture flush on page teardown. Returns false if unavailable. */
  flushWithBeacon(): boolean
  /** Uninstall the sink and stop background timers. */
  dispose(): void
}

/**
 * Assemble and install the telemetry sink. Idempotent-friendly: a later call
 * replaces the previous sink, and disposing an older handle will not clear a
 * newer sink.
 */
export function initTelemetry(options: TelemetryInitOptions): TelemetryHandle {
  const posthog =
    options.posthogHost && options.posthogApiKey
      ? new PostHogClient({
          host: options.posthogHost,
          apiKey: options.posthogApiKey,
          distinctId: options.distinctId,
          fetchImpl: options.fetchImpl,
          now: options.now,
          sendBeaconImpl: options.sendBeaconImpl,
          fallbackFlags: options.fallbackFlags,
          flagsEnabled: options.flagsDisabled !== true,
          onError: options.onError,
        })
      : null
  const otel = options.otelTracesUrl
    ? new OtelClient({
        endpoint: options.otelTracesUrl,
        serviceName: options.serviceName,
        serviceVersion: options.version,
        platform: options.platform,
        fetchImpl: options.fetchImpl,
        now: options.now,
        onError: options.onError,
      })
    : null

  posthog?.start()

  // Fail closed: a throwing/throwing-consent store must never enable egress.
  const consentGranted = (): boolean => {
    try {
      return options.getConsent() === true
    } catch {
      return false
    }
  }

  const sink: TelemetrySink = {
    track(event, props) {
      if (!consentGranted()) return
      posthog?.capture(event, props)
    },
    async getFlag(key) {
      if (!consentGranted() || !posthog) return undefined
      return posthog.getFlag(key)
    },
    trace(name, attributes) {
      if (!consentGranted() || !otel) return undefined
      return otel.startSpan(name, attributes)
    },
  }

  setTelemetrySink(sink)

  return {
    enabled: posthog !== null || otel !== null,
    track: (event, props) => sink.track(event, props ?? {}),
    getFlag: (key) => sink.getFlag(key),
    trace: (name, attributes) => sink.trace(name, attributes),
    async flush() {
      await posthog?.flush()
      await otel?.flush()
    },
    flushWithBeacon: () => posthog?.flushWithBeacon() ?? false,
    dispose() {
      posthog?.stop()
      otel?.stop()
      if (getTelemetrySink() === sink) setTelemetrySink(null)
    },
  }
}