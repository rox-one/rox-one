import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { RoxTabsBlock, RoxTabBlock, createRoxTabsContent, MAX_TABS } from '../TabsBlock'

describe('Rox tabs block', () => {
  it('creates deterministic two-tab content payloads', () => {
    expect(createRoxTabsContent(2, ['Overview', 'Details'])).toEqual({
      type: 'roxTabs',
      content: [
        { type: 'roxTab', attrs: { title: 'Overview' }, content: [{ type: 'paragraph' }] },
        { type: 'roxTab', attrs: { title: 'Details' }, content: [{ type: 'paragraph' }] },
      ],
    })
  })

  it('clamps tab count to a bounded range', () => {
    expect(createRoxTabsContent(0).content).toHaveLength(2)
    expect(createRoxTabsContent(1).content).toHaveLength(1)
    expect(createRoxTabsContent(99).content).toHaveLength(8)
  })

  it('round-trips portable markdown container syntax and keeps every pane body', () => {
    const source = [
      'Intro',
      '',
      ':::rox-tabs',
      '',
      ':::rox-tab {title="Overview"}',
      '',
      'First pane with task - [ ] ship ^tab-a',
      '',
      ':::',
      '',
      ':::rox-tab {title="Details"}',
      '',
      'Second pane keeps comments later ^tab-b',
      '',
      ':::',
      '',
      ':::',
      '',
      'Outro',
    ].join('\n')

    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        RoxTabsBlock,
        RoxTabBlock,
        Markdown,
      ],
      content: source,
      contentType: 'markdown',
    })

    const json = JSON.stringify(editor.getJSON())
    const markdown = editor.getMarkdown()

    expect(json).toContain('"type":"roxTabs"')
    expect(json).toContain('"type":"roxTab"')
    expect(json).toContain('"title":"Overview"')
    expect(json).toContain('"title":"Details"')
    expect(markdown).toContain(':::rox-tabs')
    expect(markdown).toContain(':::rox-tab')
    expect(markdown).toContain('First pane with task')
    expect(markdown).toContain('Second pane keeps comments later')
    expect(markdown).toContain('^tab-a')
    expect(markdown).toContain('^tab-b')
    // Negative control: rich serialize must not collapse panes into an opaque fence.
    expect(markdown).not.toContain('```rox-container-opaque')
    expect(markdown).not.toMatch(/```json[\s\S]*"tabs"/)

    editor.destroy()
  })

  it('round-trips columns nested inside tabs without truncating on nested :::', () => {
    const source = [
      ':::rox-tabs',
      '',
      ':::rox-tab {title="Split"}',
      '',
      ':::rox-columns {widths="50% 50%"}',
      '',
      ':::rox-column',
      '',
      'Left nested ^L',
      '',
      ':::',
      '',
      ':::rox-column',
      '',
      'Right nested ^R',
      '',
      ':::',
      '',
      ':::',
      '',
      ':::',
      '',
      ':::rox-tab {title="More"}',
      '',
      'Second pane keeps going ^S',
      '',
      ':::',
      '',
      ':::',
    ].join('\n')

    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        RoxTabsBlock,
        RoxTabBlock,
        Markdown,
      ],
      content: source,
      contentType: 'markdown',
    })

    const markdown = editor.getMarkdown()
    expect(markdown).toContain(':::rox-tabs')
    expect(markdown).toContain('Left nested')
    expect(markdown).toContain('Right nested')
    expect(markdown).toContain('Second pane keeps going')
    expect(markdown).toContain('^L')
    expect(markdown).toContain('^R')
    expect(markdown).toContain('^S')
    editor.destroy()
  })

  it('keeps imported panes beyond MAX_TABS; UI create/add still capped at MAX_TABS', () => {
    expect(createRoxTabsContent(99).content).toHaveLength(MAX_TABS)

    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        RoxTabsBlock,
        RoxTabBlock,
        Markdown,
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'roxTabs',
            content: Array.from({ length: MAX_TABS + 3 }, (_, i) => ({
              type: 'roxTab',
              attrs: { title: `T${i + 1}` },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `Body ${i + 1}` }] }],
            })),
          },
        ],
      },
    })

    let count = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'roxTabs') count = node.childCount
    })
    expect(count).toBe(MAX_TABS + 3)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('Body 1')
    expect(json).toContain(`Body ${MAX_TABS}`)
    expect(json).toContain(`Body ${MAX_TABS + 1}`)
    expect(json).toContain(`Body ${MAX_TABS + 3}`)
    const markdown = editor.getMarkdown()
    expect(markdown).toContain(`Body ${MAX_TABS + 3}`)
    editor.destroy()
  })

  it('CSS pane show rules use child combinator and is-active (no fixed 0..7 nth-child)', () => {
    const css = readFileSync(join(import.meta.dir, '../../tiptap-editor.css'), 'utf8')
    expect(css).toContain('.tiptap-rox-tabs > .tiptap-rox-tabs-panels')
    expect(css).toContain('.tiptap-rox-tab.is-active')
    expect(css).not.toMatch(/data-active-index="7"/)
    expect(css).not.toMatch(/nth-child\(8\)/)
  })

})
