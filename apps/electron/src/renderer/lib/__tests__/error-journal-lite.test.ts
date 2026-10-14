import { describe, expect, it } from 'bun:test'
import { clearErrorJournal, formatJournal, JOURNAL_MAX, recordError, redact, toEntry } from '../error-journal'
import { normalizeLite, resolveLite } from '../lite-mode'

describe('error journal', () => {
  it('redacts tokens and keys', () => {
    expect(redact('Bearer abc.def-123 fail')).toBe('Bearer [redacted] fail')
    expect(redact('GET /x?api_key=SECRET&b=1')).toBe('GET /x?api_key=[redacted]&b=1')
    expect(redact('key sk-abcdefghijkl')).toBe('key sk-[redacted]')
  })
  it('builds entries from errors and non-errors', () => {
    const e = toEntry('error', new Error('boom'), 'chat', 5)
    expect(e.message).toBe('boom'); expect(e.route).toBe('chat'); expect(e.at).toBe(5)
    expect(e.stack!.split('\n').length).toBeLessThanOrEqual(6)
    expect(toEntry('rejection', { a: 1 }).message).toBe('{"a":1}')
    expect(toEntry('rejection', '').message).toBe('(no message)')
  })
  it('formats, dedupes and stays bounded', () => {
    expect(formatJournal([toEntry('error', 'x', 'r', 0)])).toContain('error @r: x')
    clearErrorJournal()
    expect(() => {
      recordError(toEntry('error', 'same', undefined, 1000))
      recordError(toEntry('error', 'same', undefined, 1500))
      for (let i = 0; i < JOURNAL_MAX + 5; i++) recordError(toEntry('error', `e${i}`, undefined, 10_000 + i * 2000))
    }).not.toThrow()
    clearErrorJournal()
  })
})

describe('lite mode', () => {
  it('resolves preference against the system', () => {
    expect(normalizeLite('x')).toBe('auto')
    expect(resolveLite('auto', true)).toBe(true)
    expect(resolveLite('auto', false)).toBe(false)
    expect(resolveLite('off', true)).toBe(false)
    expect(resolveLite('on', false)).toBe(true)
  })
})
