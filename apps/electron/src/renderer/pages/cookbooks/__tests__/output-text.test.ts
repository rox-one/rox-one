/**
 * `normalizeOutputText` — the `\r` rule of wave 9.
 *
 * The utility is what turns a rewritten console line into the single frame a
 * terminal would leave behind, so the cases below are the terminal's own:
 * `\r\n` is a line ending, a lone `\r` rewrites its line, and a stream with no
 * `\r` at all comes back untouched.
 */
import { describe, expect, it } from 'bun:test'
import { normalizeOutputText } from '../output-text'

describe('normalizeOutputText', () => {
  it('keeps only the final frame of a tqdm-style progress bar', () => {
    expect(normalizeOutputText('  0%|          | 0/3\r 33%|###       | 1/3\r100%|##########| 3/3\n')).toBe(
      '100%|##########| 3/3\n',
    )
  })

  it('treats every `\\r\\n` as a line ending, never as a carriage return', () => {
    expect(normalizeOutputText('первая\r\nвторая\r\n')).toBe('первая\nвторая\n')
    expect(normalizeOutputText('a\r\nb\rc\r\n')).toBe('a\nc\n')
  })

  it('returns a stream without carriage returns unchanged', () => {
    const text = 'line one\nline two\n\nline four'
    expect(normalizeOutputText(text)).toBe(text)
    expect(normalizeOutputText('')).toBe('')
  })

  it('splits a mixed stream line by line, keeping the tail of every rewritten line', () => {
    expect(normalizeOutputText('start\n10%\r20%\r30%\ndone\n')).toBe('start\n30%\ndone\n')
    // A carriage return with nothing after it leaves an empty line.
    expect(normalizeOutputText('progress 100%\r')).toBe('')
  })

  it('normalizes a bare `\\r` used as a separator inside one line', () => {
    expect(normalizeOutputText('alpha\rbravo\rcharlie')).toBe('charlie')
    expect(normalizeOutputText('alpha\r\nbravo\rcharlie')).toBe('alpha\ncharlie')
  })
})
