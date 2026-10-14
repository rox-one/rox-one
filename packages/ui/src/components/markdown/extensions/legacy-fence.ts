/**
 * Legacy `tiptap-markdown` adapters for fenced rich blocks (LaTeX, Mermaid).
 *
 * The official `@tiptap/markdown` engine uses `renderMarkdown` / `parseMarkdown`
 * on the node. Notes still default to the legacy engine, which only looks at
 * `addStorage().markdown` — without it, a node serialises as `[latexBlock]`.
 */

export type LegacyMarkdownState = {
  write: (text: string) => void
  closeBlock: (node: unknown) => void
}

export function serializeLegacyFence(
  state: LegacyMarkdownState,
  node: { attrs?: { code?: string } },
  language: string,
): void {
  const code = String(node.attrs?.code ?? '').replace(/\n$/, '')
  state.write('```' + language + '\n' + code + '\n```')
  state.closeBlock(node)
}

export const fenceCodeAttribute = {
  default: '',
  parseHTML: (element: HTMLElement) => element.getAttribute('data-code') ?? '',
  renderHTML: (attributes: { code?: string }) =>
    attributes.code ? { 'data-code': attributes.code } : {},
}

/** Turn markdown-it `<pre><code class="language-…">` into the rich-block HTML the node parses. */
export function promoteFencedBlocks(
  element: HTMLElement,
  languages: ReadonlySet<string>,
  dataType: string,
): void {
  for (const pre of Array.from(element.querySelectorAll('pre'))) {
    const codeEl = pre.querySelector('code')
    const lang = (codeEl?.className.match(/language-([\w+-]+)/i)?.[1] ?? '').toLowerCase()
    if (!languages.has(lang)) continue
    const block = element.ownerDocument.createElement('div')
    block.setAttribute('data-type', dataType)
    block.setAttribute('data-code', codeEl?.textContent ?? '')
    pre.replaceWith(block)
  }
}
