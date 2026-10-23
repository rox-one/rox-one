/**
 * Legacy Markdown support for semantic tabs — same portable container family as columns.
 *
 * Wire format (Obsidian/Lark-compatible Pandoc containers, mirrors :::rox-columns):
 *
 *   :::rox-tabs
 *
 *   :::rox-tab {title="Overview"}
 *
 *   Pane body with ^block-ids and tasks
 *
 *   :::
 *
 *   :::rox-tab {title="Details"}
 *
 *   More body
 *
 *   :::
 *
 *   :::
 *
 * Aliases `tabs` / `tab` are accepted on parse. Rich serialize always writes
 * the canonical `rox-tabs` / `rox-tab` form with child content intact.
 *
 * Basic Markdown export (see packages/core/src/docs/container-codec.ts) expands
 * every pane into a labeled heading section so indexers/search never lose children.
 */

export function installLegacyTabs(markdown: any): void {
  if (markdown.__roxTabsInstalled) return
  markdown.__roxTabsInstalled = true
  markdown.block.ruler.before('fence', 'rox_tabs', (state: any, start: number, end: number, silent: boolean) => {
    const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim()
    const opening = /^:::(rox-tabs|rox-tab|tabs|tab)(?:\s+(\{[^}]*\}))?\s*$/.exec(line(start))
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
      // Count ANY Pandoc ::: open (columns/unknown nested inside tabs), same family as container-codec OPEN_RE.
      if (/^:::[A-Za-z]/.test(value)) depth++
      else if (/^:::\s*$/.test(value) && --depth === 0) break
    }
    if (depth !== 0) return false
    const previousParent = state.parentType
    const previousMax = state.lineMax
    state.parentType = 'rox-tabs'
    state.lineMax = closing
    const token = state.push('rox_tabs_open', 'div', 1)
    token.block = true
    token.map = [start, closing + 1]
    const rawKind = opening[1]!
    const kind = rawKind === 'tabs' || rawKind === 'tab' ? `rox-${rawKind}` : rawKind
    token.attrSet('data-type', kind)
    if (kind === 'rox-tab') {
      const attrs = opening[2] ?? ''
      const titleMatch = /title="([^"]*)"/.exec(attrs) ?? /title='([^']*)'/.exec(attrs)
      if (titleMatch?.[1] != null) token.attrSet('title', titleMatch[1])
    }
    state.md.block.tokenize(state, start + 1, closing)
    const close = state.push('rox_tabs_close', 'div', -1)
    close.block = true
    state.parentType = previousParent
    state.lineMax = previousMax
    state.line = closing + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}

export function serializeLegacyTabs(state: any, node: any): void {
  state.write(':::rox-tabs\n\n')
  state.renderContent(node)
  state.ensureNewLine()
  state.write(':::')
  state.closeBlock(node)
}

export function serializeLegacyTab(state: any, node: any): void {
  const title = String(node.attrs?.title ?? '').replace(/"/g, "'")
  state.write(title ? `:::rox-tab {title="${title}"}\n\n` : ':::rox-tab\n\n')
  state.renderContent(node)
  state.ensureNewLine()
  state.write(':::')
  state.closeBlock(node)
}
