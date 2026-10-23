import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { PerEditorMarkdown } from '../../official-markdown'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  buildRoxBlockDecorations,
  canonicalizeRoxBlockKind,
  collectRoxBlockTargets,
  createRoxBlockContent,
  defaultRoxBlockToggle,
  formatRoxBlockMarkdown,
  formatRoxBlockMarker,
  isRoxBlockCollapsed,
  isRoxBlockMarker,
  parseRoxBlockMarker,
  ROX_BLOCK_KINDS,
  toggleRoxBlockAt,
  toggleRoxBlockMarker,
} from '../rox-block-syntax'

const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block' },
    blockquote: { content: 'block+', group: 'block' },
  },
})

describe('ROX block syntax', () => {
  it.each([
    ['[!spoiler]- Title', { kind: 'spoiler', toggle: '-', title: 'Title' }],
    ['[!spoiler]+', { kind: 'spoiler', toggle: '+', title: undefined }],
    ['[!details]-', { kind: 'details', toggle: '-', title: undefined }],
    ['[!DETAILS]+ A visible label', { kind: 'details', toggle: '+', title: 'A visible label' }],
    ['[!note]+ Note', { kind: 'note', toggle: '+', title: 'Note' }],
    ['[!info]- Info', { kind: 'info', toggle: '-', title: 'Info' }],
    ['[!warning]+ Careful', { kind: 'warning', toggle: '+', title: 'Careful' }],
    ['[!tip]+ Hint', { kind: 'tip', toggle: '+', title: 'Hint' }],
    ['[!success]+ Done', { kind: 'success', toggle: '+', title: 'Done' }],
    ['[!question]- Why', { kind: 'question', toggle: '-', title: 'Why' }],
  ] as const)('parses portable one-line marker %s', (source, expected) => {
    expect(parseRoxBlockMarker(source)).toEqual(expected)
  })

  it.each([
    ['[!hint]+ Text', { kind: 'tip', toggle: '+', title: 'Text' }],
    ['[!important]- Text', { kind: 'tip', toggle: '-', title: 'Text' }],
    ['[!check]+ Text', { kind: 'success', toggle: '+', title: 'Text' }],
    ['[!done]+ Text', { kind: 'success', toggle: '+', title: 'Text' }],
    ['[!help]+ Text', { kind: 'question', toggle: '+', title: 'Text' }],
    ['[!faq]- Text', { kind: 'question', toggle: '-', title: 'Text' }],
    ['[!caution]+ Text', { kind: 'warning', toggle: '+', title: 'Text' }],
    ['[!attention]+ Text', { kind: 'warning', toggle: '+', title: 'Text' }],
  ] as const)('maps inbound Obsidian alias %s to canonical kind', (source, expected) => {
    expect(parseRoxBlockMarker(source)).toEqual(expected)
    expect(formatRoxBlockMarker(parseRoxBlockMarker(source)!)).toBe(
      `[!${expected.kind}]${expected.toggle} ${expected.title}`,
    )
  })

  it.each([
    '',
    '[!spoiler] Title',
    '[!spoiler]~ Title',
    '[!unknown]- Title',
    'prefix [!spoiler]- Title',
    '[!spoiler]- Title\nbody',
    '[!spoiler]- Title\rbody',
    '[!note] Title',
  ])('rejects malformed or multiline values', source => {
    expect(parseRoxBlockMarker(source)).toBeNull()
    expect(isRoxBlockMarker(source)).toBe(false)
  })

  it('exposes the eight canonical kinds and alias canonicalization', () => {
    expect([...ROX_BLOCK_KINDS]).toEqual([
      'note', 'info', 'warning', 'tip', 'success', 'question', 'spoiler', 'details',
    ])
    expect(canonicalizeRoxBlockKind('HINT')).toBe('tip')
    expect(canonicalizeRoxBlockKind('bogus')).toBeNull()
    expect(defaultRoxBlockToggle('spoiler')).toBe('-')
    expect(defaultRoxBlockToggle('note')).toBe('+')
    expect(defaultRoxBlockToggle('details')).toBe('+')
  })

  it('formats and toggles a marker deterministically', () => {
    const marker = parseRoxBlockMarker('[!spoiler]-   Reveal later  ')
    expect(marker).toEqual({ kind: 'spoiler', toggle: '-', title: 'Reveal later' })
    expect(formatRoxBlockMarker(marker!)).toBe('[!spoiler]- Reveal later')

    const expanded = toggleRoxBlockMarker(marker!)
    expect(expanded).toEqual({ kind: 'spoiler', toggle: '+', title: 'Reveal later' })
    expect(isRoxBlockCollapsed(marker!)).toBe(true)
    expect(isRoxBlockCollapsed(expanded)).toBe(false)
  })

  it('creates portable quoted Markdown for an empty or populated callout', () => {
    expect(formatRoxBlockMarkdown({ kind: 'spoiler', toggle: '-', title: 'Reveal later' })).toBe(
      '> [!spoiler]- Reveal later\n> ',
    )
    expect(formatRoxBlockMarkdown({ kind: 'details', toggle: '+', title: 'Why' }, 'First\nSecond')).toBe(
      '> [!details]+ Why\n> First\n> Second',
    )
    expect(formatRoxBlockMarkdown({ kind: 'warning', toggle: '+', title: 'Careful' }, 'Body')).toBe(
      '> [!warning]+ Careful\n> Body',
    )
  })

  it('creates only built-in quote and paragraph nodes for slash insertion', () => {
    expect(createRoxBlockContent('spoiler', 'Спойлер')).toEqual({
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '[!spoiler]- Спойлер' }],
        },
        { type: 'paragraph' },
      ],
    })
    expect(createRoxBlockContent('note', 'Note')).toEqual({
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '[!note]+ Note' }],
        },
        { type: 'paragraph' },
      ],
    })
    expect(createRoxBlockContent('details', 'Details')).toEqual({
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '[!details]+ Details' }],
        },
        { type: 'paragraph' },
      ],
    })
  })

  it('locates a plain quoted marker and persists collapse by rewriting only +/-', () => {
    const paragraph = (text: string) => testSchema.node('paragraph', null, text ? testSchema.text(text) : undefined)
    const doc = testSchema.node('doc', null, [
      testSchema.node('blockquote', null, [
        paragraph('[!spoiler]- Reveal later'),
        paragraph('Hidden body'),
      ]),
    ])
    let state = EditorState.create({ doc })
    const target = collectRoxBlockTargets(state.doc)[0]

    expect(target?.marker).toEqual({ kind: 'spoiler', toggle: '-', title: 'Reveal later' })
    expect(target?.bodyRanges).toEqual([
      expect.objectContaining({ inline: false }),
    ])
    // The editable presentation consists of a toggle widget plus a body-hide
    // decoration while the marker is collapsed. `toDOM` stays lazy, so this is
    // deterministic in Bun without a browser DOM.
    expect(buildRoxBlockDecorations(state).find()).toHaveLength(3)

    const view = {
      editable: true,
      get state() {
        return state
      },
      dispatch(transaction: typeof state.tr) {
        state = state.apply(transaction)
      },
    }
    toggleRoxBlockAt(view as never, target!)

    expect(state.doc.textContent).toContain('[!spoiler]+ Reveal later')
    expect(state.doc.textContent).toContain('Hidden body')
  })

  it('recognizes a normal external Obsidian callout in the official Markdown parser', () => {
    const source = '> [!spoiler]- Reveal later\n> Hidden body'
    const editor = new Editor({
      // Production official engine: `OfficialMarkdown` in TiptapMarkdownEditor.
      extensions: [StarterKit, PerEditorMarkdown.configure({ markedOptions: { gfm: true } })],
      content: source,
      contentType: 'markdown',
    })

    const target = collectRoxBlockTargets(editor.state.doc)[0]
    expect(target?.marker).toEqual({ kind: 'spoiler', toggle: '-', title: 'Reveal later' })
    expect(target?.bodyRanges).toEqual([
      expect.objectContaining({ inline: true }),
    ])
    expect(buildRoxBlockDecorations(editor.state).find()).toHaveLength(3)
    expect(editor.getMarkdown()).toContain('[!spoiler]- Reveal later')
    expect(editor.getMarkdown()).toContain('Hidden body')

    editor.destroy()
  })

  it.each(ROX_BLOCK_KINDS)('round-trips Markdown for kind %s', kind => {
    const marker = { kind, toggle: defaultRoxBlockToggle(kind), title: `Label ${kind}` } as const
    const source = formatRoxBlockMarkdown(marker, `Body for ${kind}`)
    const editor = new Editor({
      extensions: [StarterKit, PerEditorMarkdown.configure({ markedOptions: { gfm: true } })],
      content: source,
      contentType: 'markdown',
    })
    const target = collectRoxBlockTargets(editor.state.doc)[0]
    expect(target?.marker).toEqual(marker)
    const md = editor.getMarkdown()
    expect(md).toContain(formatRoxBlockMarker(marker))
    expect(md).toContain(`Body for ${kind}`)
    // Expanded kinds decorate with node+widget (2); collapsed spoiler also hides body (3).
    const expectedDecorations = defaultRoxBlockToggle(kind) === '-' ? 3 : 2
    expect(buildRoxBlockDecorations(editor.state).find()).toHaveLength(expectedDecorations)
    editor.destroy()
  })
})
