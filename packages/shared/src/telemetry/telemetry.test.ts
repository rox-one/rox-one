import { afterEach, describe, expect, it } from 'bun:test'
import {
  getFeatureFlag,
  initTelemetry,
  telemetryConfigFromEnv,
  track,
  trace,
} from './index.ts'
import { getTelemetrySink, setTelemetrySink } from './events.ts'

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

function recordingFetch(calls: FetchCall[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response('{}', { status: 200 })
  }) as typeof fetch
}

afterEach(() => {
  setTelemetrySink(null)
})

describe('telemetryConfigFromEnv', () => {
  it('reads and normalizes the endpoint variables', () => {
    expect(
      telemetryConfigFromEnv({
        POSTHOG_HOST: 'https://posthog.rox.one/',
        POSTHOG_API_KEY: ' ph-key ',
        OTEL_TRACES_URL: 'https://otel.rox.one///',
        OTEL_SERVICE_NAME: ' custom ',
      }),
    ).toEqual({
      posthogHost: 'https://posthog.rox.one',
      posthogApiKey: 'ph-key',
      otelTracesUrl: 'https://otel.rox.one',
      serviceName: 'custom',
    })
  })

  it('leaves endpoints empty and defaults the service name when unset', () => {
    expect(telemetryConfigFromEnv({})).toEqual({
      posthogHost: '',
      posthogApiKey: '',
      otelTracesUrl: '',
      serviceName: 'rox-desktop',
    })
  })
})

describe('initTelemetry consent gate', () => {
  it('makes zero network calls when consent is off', async () => {
    const calls: FetchCall[] = []
    const handle = initTelemetry({
      ...telemetryConfigFromEnv({
        POSTHOG_HOST: 'https://posthog.rox.one',
        POSTHOG_API_KEY: 'ph-key',
        OTEL_TRACES_URL: 'https://otel.rox.one',
      }),
      distinctId: 'anon',
      getConsent: () => false,
      fetchImpl: recordingFetch(calls),
    })
    track('onboarding_step_viewed', { step: 'username' })
    expect(await handle.getFeatureFlag('beta')).toBeUndefined()
    trace('op', { step: 'username' }).end()
    await handle.flush()
    expect(handle.enabled).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('fails closed when the consent store throws', async () => {
    const calls: FetchCall[] = []
    const handle = initTelemetry({
      posthogHost: 'https://posthog.rox.one',
      posthogApiKey: 'ph-key',
      otelTracesUrl: '',
      serviceName: 'rox-desktop',
      distinctId: 'anon',
      getConsent: () => { throw new Error('store unreadable') },
      fetchImpl: recordingFetch(calls),
    })
    track('registration_started')
    await handle.flush()
    expect(calls).toHaveLength(0)
  })

  it('sends capture + traces once consent is granted', async () => {
    const calls: FetchCall[] = []
    const handle = initTelemetry({
      posthogHost: 'https://posthog.rox.one',
      posthogApiKey: 'ph-key',
      otelTracesUrl: 'https://otel.rox.one',
      serviceName: 'rox-desktop',
      distinctId: 'anon',
      getConsent: () => true,
      fetchImpl: recordingFetch(calls),
    })
    track('registration_completed')
    trace('op').end()
    await handle.flush()
    expect(calls.map((call) => call.url).sort()).toEqual([
      'https://otel.rox.one/v1/traces',
      'https://posthog.rox.one/batch/',
    ])
  })

  it('is inert when both endpoints are unset', async () => {
    const calls: FetchCall[] = []
    const handle = initTelemetry({
      ...telemetryConfigFromEnv({}),
      distinctId: 'anon',
      getConsent: () => true,
      fetchImpl: recordingFetch(calls),
    })
    track('registration_started')
    await handle.flush()
    expect(handle.enabled).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('uninstalls the sink on dispose', () => {
    const handle = initTelemetry({
      ...telemetryConfigFromEnv({ POSTHOG_HOST: 'https://posthog.rox.one', POSTHOG_API_KEY: 'k' }),
      distinctId: 'anon',
      getConsent: () => true,
      fetchImpl: recordingFetch([]),
    })
    expect(getTelemetrySink()).not.toBeNull()
    handle.dispose()
    expect(getTelemetrySink()).toBeNull()
  })
})

describe('facade without a sink', () => {
  it('no-ops track/getFeatureFlag/trace', async () => {
    track('app_opened', { platform: 'darwin' })
    expect(await getFeatureFlag('beta')).toBeUndefined()
    expect(() => trace('op').end()).not.toThrow()
  })
})