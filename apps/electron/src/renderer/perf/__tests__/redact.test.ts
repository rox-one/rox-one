import { describe, expect, it } from 'bun:test'
import { redactSessionId, redactString, redactValue } from '../redact'

describe('perf redact', () => {
  it('strips emails, tokens, and absolute paths', () => {
    const raw = 'user@example.com used sk-abcdefghijklmnopqrstuvwxyz /Users/ada/vault and Bearer abcdefghijklmnop'
    const redacted = redactString(raw)
    expect(redacted).not.toContain('user@example.com')
    expect(redacted).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain('/Users/ada/vault')
    expect(redacted).toContain('[redacted-email]')
    expect(redacted).toContain('[redacted-token]')
    expect(redacted).toContain('[redacted-path]')
  })

  it('drops secret-bearing object keys', () => {
    const redacted = redactValue({
      id: 'sess-0001',
      content: 'secret prompt',
      apiKey: 'sk-live-not-real',
      count: 3,
    }) as Record<string, unknown>
    expect(redacted.content).toBe('[redacted]')
    expect(redacted.apiKey).toBe('[redacted]')
    expect(redacted.count).toBe(3)
  })

  it('truncates session ids for logs', () => {
    expect(redactSessionId('sess-0001-extra')).toBe('sess-000…')
  })
})
