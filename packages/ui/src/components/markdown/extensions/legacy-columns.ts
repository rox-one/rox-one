/** Legacy Markdown support for the same portable containers as @tiptap/markdown. */
export function installLegacyColumns(markdown: any): void {
  if (markdown.__roxColumnsInstalled) return
  markdown.__roxColumnsInstalled = true
  markdown.block.ruler.before('fence', 'rox_columns', (state: any, start: number, end: number, silent: boolean) => {
    const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim()
    const opening = /^:::(rox-columns|rox-column|columns|column)(?:\s+(?:\{widths="([\d.%\s]+)"\}|([23])))?\s*$/.exec(line(start))
    if (!opening || state.sCount[start] - state.blkIndent >= 4) return false
    if (silent) return true
    let depth = 1
    let closing = start + 1
    let fence: string | undefined
    for (; closing < end; closing++) {
      const value = line(closing)
      const code = /^(`{3,}|~{3,})/.exec(value)?.[1]
      if (fence) {
        if (code && code[0] === fence[0] && code.length >= fence.length && new RegExp(`^${fence[0]}+\\s*$`).test(value)) fence = undefined
        continue
      }
      if (code) { fence = code; continue }
      if (/^:::(?:rox-columns|rox-column|columns|column)(?:\s|$)/.test(value)) depth++
      else if (/^:::\s*$/.test(value) && --depth === 0) break
    }
    if (depth !== 0) return false
    const previousParent = state.parentType
    const previousMax = state.lineMax
    state.parentType = 'rox-columns'
    state.lineMax = closing
    const token = state.push('rox_columns_open', 'div', 1)
    token.block = true
    token.map = [start, closing + 1]
    const kind = opening[1]!.replace(/^columns?$/, value => `rox-${value}`)
    token.attrSet('data-type', kind)
    if (kind === 'rox-columns') token.attrSet('widths', opening[2] ?? (opening[3] === '3' ? '33.33% 33.33% 33.34%' : '50% 50%'))
    state.md.block.tokenize(state, start + 1, closing)
    const close = state.push('rox_columns_close', 'div', -1)
    close.block = true
    state.parentType = previousParent
    state.lineMax = previousMax
    state.line = closing + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}

export function serializeLegacyColumns(state: any, node: any, widths: string): void {
  state.write(`:::rox-columns {widths="${widths}"}\n\n`)
  state.renderContent(node)
  state.ensureNewLine()
  state.write(':::')
  state.closeBlock(node)
}

export function serializeLegacyColumn(state: any, node: any): void {
  state.write(':::rox-column\n\n')
  state.renderContent(node)
  state.ensureNewLine()
  state.write(':::')
  state.closeBlock(node)
}
