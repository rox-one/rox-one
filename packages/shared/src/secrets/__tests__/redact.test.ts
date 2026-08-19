/**
 * secrets/redact.ts — redactSecrets masking + process-wide registry.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  REDACTED_PLACEHOLDER,
  clearRegisteredSecretValues,
  redactRegisteredSecrets,
  redactSecrets,
  registerSecretValues,
} from '../redact.ts'

afterEach(() => {
  clearRegisteredSecretValues()
})

describe('redactSecrets', () => {
  it('masks every occurrence of each value', () => {
    const text = 'token=abc123def456; again abc123def456'
    expect(redactSecrets(text, ['abc123def456'])).toBe(`token=${REDACTED_PLACEHOLDER}; again ${REDACTED_PLACEHOLDER}`)
  })

  it('masks multiple values, longest first to avoid partial-overlap artifacts', () => {
    const text = 'a=sk-proj-abcdef b=sk-proj'
    const out = redactSecrets(text, ['sk-proj', 'sk-proj-abcdef'])
    expect(out).toBe(`a=${REDACTED_PLACEHOLDER} b=${REDACTED_PLACEHOLDER}`)
  })

  it('ignores empty and very short values (would corrupt text)', () => {
    const text = 'short values a ab abc stay put'
    expect(redactSecrets(text, ['', 'a', 'ab', 'abc'])).toBe(text)
  })

  it('is case-sensitive (secret values are case-sensitive)', () => {
    const text = 'VALUE=SecretValueX and secretvaluex'
    expect(redactSecrets(text, ['SecretValueX'])).toBe(`VALUE=${REDACTED_PLACEHOLDER} and secretvaluex`)
  })

  it('returns the input unchanged when no values are given', () => {
    expect(redactSecrets('hello world', [])).toBe('hello world')
  })

  it('handles regex metacharacters in values literally', () => {
    const text = 'key=p@ss.(w0rd).*? safe'
    expect(redactSecrets(text, ['p@ss.(w0rd).*?'])).toBe(`key=${REDACTED_PLACEHOLDER} safe`)
  })
})

describe('redaction registry', () => {
  it('redactRegisteredSecrets masks registered values only', () => {
    registerSecretValues(['registered-secret-value'])
    expect(redactRegisteredSecrets('leak registered-secret-value here')).toBe(`leak ${REDACTED_PLACEHOLDER} here`)
    expect(redactRegisteredSecrets('something-else-entirely stays')).toBe('something-else-entirely stays')
  })

  it('clearRegisteredSecretValues empties the registry', () => {
    registerSecretValues(['registered-secret-value'])
    clearRegisteredSecretValues()
    expect(redactRegisteredSecrets('leak registered-secret-value')).toBe('leak registered-secret-value')
  })

  it('registerSecretValues dedupes and ignores short values', () => {
    registerSecretValues(['same-value-here', 'same-value-here', 'xy'])
    expect(redactRegisteredSecrets('same-value-here xy')).toBe(`${REDACTED_PLACEHOLDER} xy`)
  })
})
