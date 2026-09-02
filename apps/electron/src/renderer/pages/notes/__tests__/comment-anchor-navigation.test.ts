import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { TiptapEditorHandle } from '@craft-agent/ui'
import { findDocRangeForComment } from '../../NotesPage'

function createEditor() {
  return new Editor({
    extensions: [StarterKit],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'bold ' },
            { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://rox.one' } }], text: 'link' },
            { type: 'text', text: ' after' },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph' }],
        },
      ],
    },
  })
}

function asHandle(editor: Editor): TiptapEditorHandle {
  return editor as unknown as TiptapEditorHandle
}

describe('comment anchor navigation', () => {
  it('selects a quote spanning bold and link text nodes', () => {
    const editor = createEditor()
    const quote = 'bold link'

    const range = findDocRangeForComment(asHandle(editor), quote)

    expect(range).not.toBeNull()
    expect(editor.state.doc.textBetween(range!.from, range!.to, '\n', '\n')).toBe(quote)
    editor.destroy()
  })

  it('uses resolved document-wide offsets across a paragraph boundary', () => {
    const editor = createEditor()
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')
    const quote = 'after\nSecond'
    const start = fullText.indexOf(quote)

    const range = findDocRangeForComment(asHandle(editor), quote, {
      start,
      end: start + quote.length,
    })

    expect(range).not.toBeNull()
    expect(editor.state.doc.textBetween(range!.from, range!.to, '\n', '\n')).toBe(quote)
    editor.destroy()
  })
})
