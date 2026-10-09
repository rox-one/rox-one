import { afterEach, describe, expect, it } from 'bun:test'
import {
  getFlag,
  initTelemetry,
  telemetryConfigFromEnv,
  track,
  trackOnboardingLearning,
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

function batchBody(call: FetchCall): { api_key: string; batch: Array<Record<string, unknown>> } {
  return JSON.parse(String(call.init?.body)) as {
    api_key: string
    batch: Array<Record<string, unknown>>
  }
}

afterEach(() => {
  setTelemetrySink(null)
})

describe('telemetryConfigFromEnv', () => {
  it('reads and normalizes the endpoint variables', () => {
    expect(
      telemetryConfigFromEnv({
        POSTHOG_HOST: 'https://posthog.rox.one/',
        POSTHOG_KEY: ' ph-key ',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.rox.one///',
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
        POSTHOG_KEY: 'ph-key',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.rox.one',
      }),
      distinctId: 'anon',
      getConsent: () => false,
      fetchImpl: recordingFetch(calls),
    })
    track('onboarding_step_viewed', { step: 'username' })
    trackOnboardingLearning([{ name: 'saw', stepId: 'identity', source: 'human' }])
    expect(await handle.getFlag('beta')).toBeUndefined()
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

  it('sends capture to the configured host/key once consent is granted', async () => {
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
    track('app_launched', { platform: 'darwin', version: '1.2.3' })
    trace('op').end()
    await handle.flush()
    expect(calls.map((call) => call.url).sort()).toEqual([
      'https://otel.rox.one/v1/traces',
      'https://posthog.rox.one/batch/',
    ])
    const capture = calls.find((call) => call.url === 'https://posthog.rox.one/batch/')!
    const body = batchBody(capture)
    expect(body.api_key).toBe('ph-key')
    expect(body.batch[0]!.event).toBe('app_launched')
    expect((body.batch[0]!.properties as Record<string, unknown>).version).toBe('1.2.3')
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
      ...telemetryConfigFromEnv({ POSTHOG_HOST: 'https://posthog.rox.one', POSTHOG_KEY: 'k' }),
      distinctId: 'anon',
      getConsent: () => true,
      fetchImpl: recordingFetch([]),
    })
    expect(getTelemetrySink()).not.toBeNull()
    handle.dispose()
    expect(getTelemetrySink()).toBeNull()
  })
})

describe('feature flag kill switch', () => {
  it('never fetches /decide when disabled and answers from the fallback map', async () => {
    const calls: FetchCall[] = []
    const handle = initTelemetry({
      posthogHost: 'https://posthog.rox.one',
      posthogApiKey: 'ph-key',
      otelTracesUrl: '',
      serviceName: 'rox-desktop',
      distinctId: 'anon',
      getConsent: () => true,
      flagsDisabled: true,
      fallbackFlags: { beta: 'control' },
      fetchImpl: recordingFetch(calls),
    })
    expect(await handle.getFlag('beta')).toBe('control')
    expect(await handle.getFlag('unknown')).toBeUndefined()
    expect(calls).toHaveLength(0)
  })
})

describe('learning-curve drain mapping', () => {
  it('maps drained events to consent-gated onboarding_learning captures', async () => {
    const calls: FetchCall[] = []
    const handle = initTelemetry({
      posthogHost: 'https://posthog.rox.one',
      posthogApiKey: 'ph-key',
      otelTracesUrl: '',
      serviceName: 'rox-desktop',
      distinctId: 'anon',
      getConsent: () => true,
      fetchImpl: recordingFetch(calls),
    })
    trackOnboardingLearning([
      { name: 'saw', stepId: 'identity', source: 'human' },
      { name: 'tried', stepId: 'questionnaire', source: 'agent' },
    ])
    await handle.flush()
    const body = batchBody(calls[0]!)
    expect(body.batch.map((event) => event.event)).toEqual(['onboarding_learning', 'onboarding_learning'])
    expect(body.batch[0]!.properties).toMatchObject({ learning: 'saw', step: 'identity', actor: 'human' })
    expect(body.batch[1]!.properties).toMatchObject({ learning: 'tried', step: 'questionnaire', actor: 'agent' })
  })
})

describe('facade without a sink', () => {
  it('no-ops track/getFlag/trace', async () => {
    track('app_launched', { platform: 'darwin' })
    expect(await getFlag('beta')).toBeUndefined()
    expect(() => trace('op').end()).not.toThrow()
  })
})