import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { RoxColumnsBlock, RoxColumnBlock, buildKeyboardResizeWidths, createRoxColumnsContent } from '../ColumnsBlock'

describe('Rox columns block', () => {
  it('creates deterministic 2-column and 3-column content payloads', () => {
    expect(createRoxColumnsContent(2)).toEqual({
      type: 'roxColumns',
      attrs: { widths: '50% 50%' },
      content: [
        { type: 'roxColumn', content: [{ type: 'paragraph' }] },
        { type: 'roxColumn', content: [{ type: 'paragraph' }] },
      ],
    })

    expect(createRoxColumnsContent(3)).toEqual({
      type: 'roxColumns',
      attrs: { widths: '33.33% 33.33% 33.34%' },
      content: [
        { type: 'roxColumn', content: [{ type: 'paragraph' }] },
        { type: 'roxColumn', content: [{ type: 'paragraph' }] },
        { type: 'roxColumn', content: [{ type: 'paragraph' }] },
      ],
    })
  })

  it('keeps keyboard resizing bounded and normalized', () => {
    expect(buildKeyboardResizeWidths([50, 50], 0, 1)).toEqual([54, 46])
    expect(buildKeyboardResizeWidths([82, 18], 0, 1)).toEqual([82, 18])
    expect(buildKeyboardResizeWidths([20, 40, 40], 0, -1)).toEqual([18, 42, 40])
  })

  it('round-trips portable markdown container syntax', () => {
    const source = [
      'Intro',
      '',
      ':::rox-columns {widths="60% 40%"}',
      '',
      ':::rox-column',
      '',
      'Left column',
      '',
      ':::',
      '',
      ':::rox-column',
      '',
      'Right column',
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
        RoxColumnsBlock,
        RoxColumnBlock,
        Markdown,
      ],
      content: source,
      contentType: 'markdown',
    })

    const json = JSON.stringify(editor.getJSON())
    const markdown = editor.getMarkdown()

    expect(json).toContain('"type":"roxColumns"')
    expect(json).toContain('"type":"roxColumn"')
    expect(json).toContain('"widths":"60% 40%"')
    expect(markdown).toContain(':::rox-columns')
    expect(markdown).toContain(':::rox-column')
    expect(markdown).toContain('Left column')
    expect(markdown).toContain('Right column')

    editor.destroy()
  })
})
