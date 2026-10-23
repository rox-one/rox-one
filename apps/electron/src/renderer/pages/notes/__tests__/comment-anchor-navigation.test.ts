import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { TiptapEditorHandle } from '@rox/ui'
import { commentDraftOffsetsFromEditor, findDocRangeForComment } from '../../NotesPage'

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

describe('commentDraftOffsetsFromEditor', () => {
  it('maps the TipTap selection through buildCommentTextMap into markdown offsets', () => {
    const editor = createEditor()
    const quote = 'bold link'
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')
    const start = fullText.indexOf(quote)
    expect(start).toBeGreaterThanOrEqual(0)

    const range = findDocRangeForComment(asHandle(editor), quote)
    expect(range).not.toBeNull()
    editor.commands.setTextSelection({ from: range!.from, to: range!.to })

    const markdown = fullText
    const offsets = commentDraftOffsetsFromEditor(asHandle(editor), markdown, quote)
    expect(offsets).toEqual({ start, end: start + quote.length })

    const again = findDocRangeForComment(asHandle(editor), quote, offsets!)
    expect(again).toEqual(range)
    editor.destroy()
  })

  it('falls back to findQuoteWithContext when markdown and comment-text map diverge', () => {
    const editor = createEditor()
    const quote = 'Second paragraph'
    const range = findDocRangeForComment(asHandle(editor), quote)
    expect(range).not.toBeNull()
    editor.commands.setTextSelection({ from: range!.from, to: range!.to })

    // Markdown uses a blank line between paragraphs; comment-text map uses a single newline.
    const markdown = 'Before bold link after\n\nSecond paragraph'
    const offsets = commentDraftOffsetsFromEditor(asHandle(editor), markdown, quote)
    expect(offsets).not.toBeNull()
    expect(markdown.slice(offsets!.start, offsets!.end)).toBe(quote)
    editor.destroy()
  })

  it('returns null for an empty selection', () => {
    const editor = createEditor()
    editor.commands.setTextSelection(1)
    expect(commentDraftOffsetsFromEditor(asHandle(editor), 'anything', 'x')).toBeNull()
    editor.destroy()
  })
})
