import { describe, expect, it } from 'bun:test'
import { buildOtlpPayload, OtelClient, type OtelPayload, type OtelSpan } from './otel.ts'

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

function recordingFetch(
  calls: FetchCall[],
  respond: () => Response | Promise<Response> = () => new Response('{}', { status: 200 }),
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return respond()
  }) as typeof fetch
}

const FIXED_HEX = 'a'.repeat(16)

describe('buildOtlpPayload', () => {
  it('emits the OTLP/HTTP JSON span shape with resource attributes', () => {
    const span: OtelSpan = {
      name: 'onboarding.username_check',
      traceId: 'b'.repeat(32),
      spanId: 'c'.repeat(16),
      startTimeMs: 1_700_000_000_000,
      endTimeMs: 1_700_000_000_123,
      attributes: { step: 'username', cached: false, count: 3, ratio: 0.5 },
      status: 'ok',
    }
    const payload = buildOtlpPayload([span], {
      serviceName: 'rox-desktop',
      serviceVersion: '1.2.3',
      platform: 'darwin',
    })
    const [resourceSpan] = payload.resourceSpans
    expect(resourceSpan).toBeDefined()
    expect(resourceSpan!.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'rox-desktop' } },
      { key: 'service.version', value: { stringValue: '1.2.3' } },
      { key: 'service.platform', value: { stringValue: 'darwin' } },
    ])
    const [scopeSpan] = resourceSpan!.scopeSpans
    expect(scopeSpan!.scope).toEqual({ name: 'rox-desktop' })
    const [out] = scopeSpan!.spans
    expect(out).toMatchObject({
      traceId: 'b'.repeat(32),
      spanId: 'c'.repeat(16),
      name: 'onboarding.username_check',
      kind: 1,
      startTimeUnixNano: (BigInt(1_700_000_000_000) * 1_000_000n).toString(),
      endTimeUnixNano: (BigInt(1_700_000_000_123) * 1_000_000n).toString(),
      status: { code: 1 },
    })
    expect(out!.attributes).toEqual([
      { key: 'step', value: { stringValue: 'username' } },
      { key: 'cached', value: { boolValue: false } },
      { key: 'count', value: { intValue: '3' } },
      { key: 'ratio', value: { doubleValue: 0.5 } },
    ])
  })

  it('redacts sensitive span attributes', () => {
    const payload = buildOtlpPayload(
      [{ name: 'x', traceId: 't', spanId: 's', startTimeMs: 0, endTimeMs: 1, attributes: { token: 'abc', step: 'profile' } }],
      { serviceName: 'rox-desktop' },
    )
    const attributes = payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes
    expect(attributes.map((attribute) => attribute.key)).toEqual(['step'])
  })
})

describe('OtelClient', () => {
  it('POSTs buffered spans to {endpoint}/v1/traces', async () => {
    const calls: FetchCall[] = []
    const client = new OtelClient({
      endpoint: 'https://otel.rox.one/',
      serviceName: 'rox-desktop',
      serviceVersion: '9.9.9',
      platform: 'darwin',
      fetchImpl: recordingFetch(calls),
      now: () => 1_700_000_000_000,
      randomHex: () => FIXED_HEX,
    })
    const handle = client.startSpan('op', { step: 'welcome' })
    handle.end({ ok: true })
    await client.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://otel.rox.one/v1/traces')
    const body = JSON.parse(String(calls[0]!.init?.body)) as OtelPayload
    const span = body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(span.name).toBe('op')
    expect(span.attributes).toEqual([
      { key: 'step', value: { stringValue: 'welcome' } },
      { key: 'ok', value: { boolValue: true } },
    ])
  })

  it('drops oldest spans past the 100-span buffer', async () => {
    const calls: FetchCall[] = []
    const client = new OtelClient({
      endpoint: 'https://otel.rox.one', fetchImpl: recordingFetch(calls), randomHex: () => FIXED_HEX,
    })
    for (let index = 0; index < 105; index += 1) {
      client.recordSpan({ name: `s${index}`, traceId: FIXED_HEX.repeat(2), spanId: FIXED_HEX, startTimeMs: index, endTimeMs: index })
    }
    await client.flush()
    const spans = (JSON.parse(String(calls[0]!.init?.body)) as OtelPayload).resourceSpans[0]!.scopeSpans[0]!.spans
    expect(spans).toHaveLength(100)
    expect(spans[0]!.name).toBe('s5')
    expect(spans[99]!.name).toBe('s104')
  })

  it('never throws when the endpoint fails', async () => {
    const client = new OtelClient({
      endpoint: 'https://otel.rox.one',
      fetchImpl: recordingFetch([], () => { throw new Error('unreachable') }),
      randomHex: () => FIXED_HEX,
    })
    client.recordSpan({ name: 'x', traceId: 't', spanId: 's', startTimeMs: 0, endTimeMs: 1 })
    await expect(client.flush()).resolves.toBeUndefined()
  })

  it('is inert without an endpoint', async () => {
    const calls: FetchCall[] = []
    const client = new OtelClient({ endpoint: '', fetchImpl: recordingFetch(calls) })
    const handle = client.startSpan('x')
    handle.end()
    await client.flush()
    expect(client.enabled).toBe(false)
    expect(calls).toHaveLength(0)
  })
})