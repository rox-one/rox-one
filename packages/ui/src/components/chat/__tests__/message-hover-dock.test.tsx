import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageHoverDock, MESSAGE_DOCK_MAX_VISIBLE } from '../MessageHoverDock'

const noop = () => {}

describe('MessageHoverDock', () => {
  it('shows listen and branch after quote and before the overflow menu', () => {
    const html = renderToStaticMarkup(
      <MessageHoverDock
        reactionCounts={[]}
        onToggleHeart={noop}
        onToggleEmoji={noop}
        onCopy={noop}
        onQuote={noop}
        onLearn={noop}
        onPickSideThread={noop}
        extraActions={[{ id: 'listen', label: 'Listen', onSelect: noop }, { id: 'branch', label: 'Branch', onSelect: noop }, { id: 'markdown', label: 'Markdown', onSelect: noop }]}
      />,
    )
    const buttons = html.match(/<button/g) ?? []
    expect(buttons.length).toBe(MESSAGE_DOCK_MAX_VISIBLE + 1)
    // Overflow items stay inside the closed menu, not in the toolbar.
    expect(html).toContain('Listen')
    expect(html).toContain('Branch')
    expect(html).not.toContain('Markdown')
    expect(html.indexOf('Listen')).toBeLessThan(html.indexOf('Branch'))
  })

  it('has no dead actions: no share (duplicate of copy) and no no-op highlight', () => {
    const source = readFileSync(join(__dirname, '..', 'MessageHoverDock.tsx'), 'utf8')
    expect(source).not.toMatch(/onShare|onHighlight|Share2|Highlighter/)
    const turn = readFileSync(join(__dirname, '..', 'TurnCard.tsx'), 'utf8')
    expect(turn).not.toContain('contentLayerRef.current?.focus()')
  })

  it('copy awaits the clipboard write so feedback reflects real success', () => {
    const source = readFileSync(join(__dirname, '..', 'MessageHoverDock.tsx'), 'utf8')
    expect(source).toMatch(/await onCopy\(\)[\s\S]{0,80}setCopied\(true\)/)
  })
})
