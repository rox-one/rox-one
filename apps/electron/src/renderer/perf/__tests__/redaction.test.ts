import { describe, expect, it } from 'bun:test'
import { REDACTED, redactTelemetryPayload } from '../redaction'
import { PerfTelemetry } from '../telemetry'

describe('telemetry redaction', () => {
  it('strips secret keys and bearer-like values before storage', () => {
    const telemetry = new PerfTelemetry()
    const sample = telemetry.recordPayload({
      preview: 'hello',
      authorization: 'Bearer sk-live-supersecretvalue',
      cookie: 'sid=abc',
      sharedOwnerKey: 'owner-secret',
      nested: { token: 'ghp_abcdefghijklmnopqrstuv', note: 'ok' },
    })

    const redacted = sample.redacted as Record<string, unknown>
    expect(redacted.preview).toBe('hello')
    expect(redacted.authorization).toBe(REDACTED)
    expect(redacted.cookie).toBe(REDACTED)
    expect(redacted.sharedOwnerKey).toBe(REDACTED)
    expect((redacted.nested as Record<string, unknown>).token).toBe(REDACTED)
    expect((redacted.nested as Record<string, unknown>).note).toBe('ok')
    expect(JSON.stringify(sample.redacted)).not.toContain('supersecret')
    expect(JSON.stringify(sample.redacted)).not.toContain('ghp_')
  })

  it('redacts secret substrings in free text', () => {
    expect(redactTelemetryPayload('Authorization: Bearer sk-abcdefghijklmnop')).toBe(
      `Authorization: ${REDACTED}`,
    )
  })
})
