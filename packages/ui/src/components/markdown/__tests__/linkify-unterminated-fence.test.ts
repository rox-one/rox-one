/**
 * W1 — an unterminated code fence (e.g. an ```openui block still streaming)
 * must extend to EOF so its body is never linkified.
 */
import { describe, expect, it } from 'bun:test'
import { preprocessLinks } from '../linkify'

describe('preprocessLinks — unterminated fence', () => {
  it('does not rewrite a URL inside a fence that is still open', () => {
    const source = [
      '```openui',
      'root = Card([t])',
      't = TextContent("see https://example.com now")',
      '',
    ].join('\n')
    expect(preprocessLinks(source)).toBe(source)
  })

  it('still rewrites a URL outside a fence', () => {
    expect(preprocessLinks('See https://example.com now'))
      .toBe('See [https://example.com](https://example.com) now')
  })
})