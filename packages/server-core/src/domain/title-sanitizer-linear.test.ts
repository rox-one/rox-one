import { describe, expect, it } from 'bun:test'
import { sanitizeForTitle } from './title-sanitizer.ts'

describe('title delimiter grammar', () => {
  it('keeps empty and unclosed tags but strips nonempty first-close tags', () => {
    expect(sanitizeForTitle('<> <><a<b> tail <unclosed')).toBe('<> <> tail <unclosed')
    expect(sanitizeForTitle('<'.repeat(16384))).toBe('<'.repeat(16384))
  })
  it('strips non-nesting edit blocks including empty and multiline blocks, retaining unclosed body', () => {
    expect(sanitizeForTitle('a<edit_request></edit_request>b<edit_request>x\n<edit_request>y</edit_request>z</edit_request>')).toBe('abz')
    expect(sanitizeForTitle('<edit_request>'.repeat(8192) + 'keep')).toBe('keep')
  })
  it('retains bracket, markdown, Unicode and sequential stripping semantics', () => {
    expect(sanitizeForTitle('[file:] [folder:] [file:[file:x]] [folder:a] [text](https://x) 🐛 中文')).toBe('[file:] [folder:] ] [text](https://x) 🐛 中文')
    const text = '[file:'.repeat(16384)
    expect(sanitizeForTitle(text)).toBe(text)
  })
})
