import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { RoxTabsBlock, RoxTabBlock, createRoxTabsContent } from '../TabsBlock'

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
})
