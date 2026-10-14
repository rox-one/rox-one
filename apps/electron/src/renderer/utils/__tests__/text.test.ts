/**
 * `stripMarkdown` contract.
 *
 * The preview shows up to 100 characters of the last assistant message in an OS
 * notification, so the contract is "readable one-line text". The table below was
 * produced by the previous implementation (`remark().use(stripMarkdown)` — the
 * unified/mdast/micromark pipeline) and re-verified against the scanner that
 * replaced it, which keeps that whole pipeline out of the eager boot closure.
 *
 * Cases marked `improved` are deliberate deviations from the remark output; the
 * remark value is quoted next to each so the difference is reviewable rather
 * than accidental.
 */
import { describe, expect, it } from 'bun:test'
import { stripMarkdown } from '../text'

const CASES: ReadonlyArray<readonly [input: string, expected: string]> = [
  // --- block constructs -----------------------------------------------------
  ['# Heading one\n\nBody text.', 'Heading one Body text.'],
  ['### Deep heading ###', 'Deep heading'],
  ['Setext\n======', 'Setext'],
  ['> quoted line\n> second', 'quoted line second'],
  ['> > deep quote', 'deep quote'],
  ['- item one\n- item two\n  - nested', 'item one item two nested'],
  ['1. first\n2. second', 'first second'],
  ['* one\n* two', 'one two'],
  ['before\n\n***\n\nafter', 'before after'],
  ['```js\nconst x = 1\n```', ''],
  ['~~~\ntilde fence\n~~~', ''],
  ['<div>html block</div>', ''],
  ['<p align="center"><img src="x.png"></p>', ''],
  ['<!-- comment -->visible', ''],
  ['A &amp; B &lt;tag&gt; &quot;q&quot; &#39;s&#39;', 'A & B <tag> "q" \'s\''],

  // --- inline constructs ----------------------------------------------------
  ['**bold** and *italic* and `code`', 'bold and italic and code'],
  ['see [docs](https://example.com) for more', 'see docs for more'],
  ['![alt text](https://example.com/img.png)', 'alt text'],
  ['text with <b>inline html</b> here', 'text with inline html here'],
  ['Auto link <https://example.com> here', 'Auto link https://example.com here'],
  ['Nested **bold _italic_** end', 'Nested bold italic end'],
  ['**bold with [link](http://x) inside**', 'bold with link inside'],
  [`\`inline code with **stars**\``, 'inline code with **stars**'],
  ['a ``code with ` tick`` b', 'a code with ` tick b'],
  ['[link](https://example.com/a_(b)) end', 'link end'],

  // --- text that must survive untouched ------------------------------------
  ['use snake_case_name here', 'use snake_case_name here'],
  ['call __init__ method', 'call init method'],
  ['see https://example.com/foo_bar_baz now', 'see https://example.com/foo_bar_baz now'],
  ['open C:\\Users\\t\\file.txt now', 'open C:\\Users\\t\\file.txt now'],
  ['line one\nline two', 'line one line two'],
  ['line one  \nline two (hard break)', 'line one line two (hard break)'],
  ['Многострочный\n\n\nтекст с  пробелами', 'Многострочный текст с пробелами'],

  // --- emoji + whitespace normalization ------------------------------------
  ['emoji 🚀 test 🎉 done', 'emoji test done'],
  ['family 👨‍👩‍👧 and flag 🇷🇺 done', 'family and flag done'], // remark left the ZWJ tail behind
  // A keycap is a digit plus VS16 plus U+20E3: the digit itself is text and stays.
  ['warning ⚠️ and heart ❤️ and key 1️⃣', 'warning and heart and key 1'],
  ['', ''],
  ['   ', ''],

  // --- improved over the remark pipeline (remark output quoted) -------------
  ['~~strike~~ and __strong__ and _em_', 'strike and strong and em'], // was `\~~strike~~ and strong and em`
  ['- [ ] todo\n- [x] done', 'todo done'], // was `\[ ] todo \[x] done`
  ['Footnote ref[^1]\n\n[^1]: the note', 'Footnote ref'], // was `Footnote ref\[^1] \[^1]: the note`
  ['text[^note]', 'text'], // was `text\[^note]`
  ['Escaped \\*not italic\\* text', 'Escaped *not italic* text'], // was `Escaped \*not italic\* text`
  ['2 * 3 = 6 and 4 * 5', '2 * 3 = 6 and 4 * 5'], // was `2 \* 3 = 6 and 4 \* 5`
  ['start **bold without close', 'start **bold without close'], // was `start \*\*bold without close`
  ['ends with backslash \\', 'ends with backslash \\'], // was `ends with backslash \\`
]

describe('stripMarkdown', () => {
  for (const [input, expected] of CASES) {
    it(`${JSON.stringify(input).slice(0, 60)} → ${JSON.stringify(expected).slice(0, 60)}`, () => {
      expect(stripMarkdown(input)).toBe(expected)
    })
  }

  it('keeps the realistic notification preview readable', () => {
    expect(stripMarkdown('Готово! **Итог:** обновил `webui/src/index.css` — [PR](https://github.com/x/y/pull/1) 🚀'))
      .toBe('Готово! Итог: обновил webui/src/index.css — PR')
  })

  it('collapses a long message into one bounded line', () => {
    const long = `${'word '.repeat(200)}**end**`
    const out = stripMarkdown(long)
    expect(out.endsWith('end')).toBe(true)
    expect(out).not.toContain('\n')
    expect(out).not.toContain('  ')
  })
})
