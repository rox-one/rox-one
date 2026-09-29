import { Node } from '@tiptap/core'

/**
 * Preserves standalone HTML comment lines (`<!-- … -->`) in the legacy
 * tiptap-markdown pipeline without showing them as text.
 *
 * With `html: false` markdown-it escapes comments, so machine markers such as
 * `<!-- rox:daily-sessions -->` or `<!-- rox:comment … -->…<!-- /rox:comment -->`
 * rendered as raw text in notes. This block node keeps the exact source,
 * renders nothing visible, and serializes the source back verbatim so the
 * markers (and the server-side daily-sessions merge that depends on them)
 * survive a round trip.
 */

const COMMENT_OPEN = /^<!--/
const ROX_COMMENT_OPEN = /^<!--\s*rox:comment\b/
const ROX_COMMENT_CLOSE = /<!--\s*\/rox:comment\s*-->\s*$/

type BlockState = {
  src: string
  bMarks: number[]
  tShift: number[]
  eMarks: number[]
  sCount: number[]
  blkIndent: number
  line: number
  push: (type: string, tag: string, nesting: number) => { content: string; map: [number, number] | null; block: boolean }
}

function lineText(state: BlockState, line: number): string {
  return state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!)
}

/**
 * Find the last line of a comment block that starts at `startLine`.
 * Returns -1 when the line does not open a standalone comment block.
 */
export function findMarkdownCommentEnd(lines: readonly string[], startLine: number): number {
  const first = lines[startLine]?.trim() ?? ''
  if (!COMMENT_OPEN.test(first)) return -1
  if (ROX_COMMENT_OPEN.test(first)) {
    for (let line = startLine; line < lines.length; line += 1) {
      if (ROX_COMMENT_CLOSE.test(lines[line]!.trim())) return line
    }
    return -1
  }
  // A plain comment must close on a line that ends with `-->` and carry no
  // trailing content, otherwise it is ordinary text.
  for (let line = startLine; line < lines.length; line += 1) {
    const text = lines[line]!.trim()
    const closeAt = text.indexOf('-->', line === startLine ? 4 : 0)
    if (closeAt === -1) continue
    return text.slice(closeAt + 3).trim() === '' ? line : -1
  }
  return -1
}

const installed = new WeakSet<object>()

function installCommentRule(md: {
  block: { ruler: { before: (name: string, rule: string, fn: unknown, opts?: { alt: string[] }) => void } }
  renderer: { rules: Record<string, unknown> }
  utils: { escapeHtml: (value: string) => string }
}) {
  if (installed.has(md)) return
  installed.add(md)
  md.block.ruler.before(
    'paragraph',
    'rox_md_comment',
    (state: BlockState, startLine: number, endLine: number, silent: boolean) => {
      if (state.sCount[startLine]! - state.blkIndent >= 4) return false
      const first = lineText(state, startLine)
      if (!COMMENT_OPEN.test(first)) return false
      const lines: string[] = []
      for (let line = startLine; line < endLine; line += 1) lines.push(lineText(state, line))
      const end = findMarkdownCommentEnd(lines, 0)
      if (end === -1) return false
      if (silent) return true
      const token = state.push('rox_md_comment', '', 0)
      token.content = lines.slice(0, end + 1).join('\n')
      token.map = [startLine, startLine + end + 1]
      token.block = true
      state.line = startLine + end + 1
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )
  md.renderer.rules.rox_md_comment = (tokens: Array<{ content: string }>, idx: number) =>
    `<div data-md-comment="${md.utils.escapeHtml(tokens[idx]!.content)}"></div>`
}

export const MarkdownComment = Node.create({
  name: 'markdownComment',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-md-comment') ?? '',
        renderHTML: (attributes: { raw?: string }) => ({ 'data-md-comment': attributes.raw ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-md-comment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, class: 'tiptap-md-comment', 'aria-hidden': 'true', contenteditable: 'false' }]
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (text: string) => void; closeBlock: (node: unknown) => void },
          node: { attrs: { raw?: string } },
        ) {
          state.write(node.attrs.raw ?? '')
          state.closeBlock(node)
        },
        parse: {
          setup(markdownit: Parameters<typeof installCommentRule>[0]) {
            installCommentRule(markdownit)
          },
        },
      },
    }
  },
})
