import { describe, expect, it } from 'bun:test'
import markdownit from 'markdown-it'
import { MarkdownComment, findMarkdownCommentEnd } from '../extensions/MarkdownComment'

const DAILY = [
  '# 2026-09-22',
  '',
  '## Sessions',
  '',
  '<!-- rox:daily-sessions -->',
  '- Утренний план',
  '- Ревью PR',
  '<!-- /rox:daily-sessions -->',
  '',
].join('\n')

function render(markdown: string): string {
  const md = markdownit({ html: false })
  const storage = MarkdownComment.storage as { markdown: { parse: { setup: (md: unknown) => void } } }
  storage.markdown.parse.setup(md)
  storage.markdown.parse.setup(md) // idempotent: re-running setup on each parse must not double-install
  return md.render(markdown)
}

describe('MarkdownComment (legacy markdown pipeline)', () => {
  it('turns daily-sessions markers into hidden comment nodes instead of escaped text', () => {
    const html = render(DAILY)
    expect(html).not.toMatch(/<p>[^<]*&lt;!--/)
    expect(html).not.toMatch(/<li>[^<]*&lt;!--/)
    expect(html.match(/data-md-comment=/g)?.length).toBe(2)
    expect(html).toContain('data-md-comment="&lt;!-- rox:daily-sessions --&gt;"')
    expect(html).toContain('data-md-comment="&lt;!-- /rox:daily-sessions --&gt;"')
    expect(html).toContain('<li>Утренний план</li>')
    expect(html).toContain('<li>Ревью PR</li>')
  })

  it('keeps a whole rox:comment block (markers + body) as one node', () => {
    const html = render('Text\n\n<!-- rox:comment id="a" quote="q" created="1" -->\nbody line\n<!-- /rox:comment -->\n')
    expect(html.match(/data-md-comment=/g)?.length).toBe(1)
    expect(html).toContain('body line')
    expect(html).not.toContain('<p>body line</p>')
  })

  it('leaves inline or unterminated comments as ordinary text', () => {
    expect(findMarkdownCommentEnd(['<!-- open', 'still open'], 0)).toBe(-1)
    expect(findMarkdownCommentEnd(['<!-- x --> trailing'], 0)).toBe(-1)
    expect(findMarkdownCommentEnd(['text <!-- x -->'], 0)).toBe(-1)
    expect(findMarkdownCommentEnd(['<!-- a', 'b -->'], 0)).toBe(1)
  })

  it('serializes the raw source back verbatim', () => {
    const storage = MarkdownComment.storage as {
      markdown: { serialize: (state: { write: (t: string) => void; closeBlock: (n: unknown) => void }, node: { attrs: { raw: string } }) => void }
    }
    let out = ''
    storage.markdown.serialize({ write: (t) => { out += t }, closeBlock: () => { out += '\n\n' } }, { attrs: { raw: '<!-- /rox:daily-sessions -->' } })
    expect(out).toBe('<!-- /rox:daily-sessions -->\n\n')
  })
})
