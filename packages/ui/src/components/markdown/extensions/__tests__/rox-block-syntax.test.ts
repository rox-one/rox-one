import { describe, expect, it } from 'bun:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  buildRoxBlockDecorations,
  collectRoxBlockTargets,
  createRoxBlockContent,
  formatRoxBlockMarkdown,
  formatRoxBlockMarker,
  isRoxBlockCollapsed,
  isRoxBlockMarker,
  parseRoxBlockMarker,
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
  ] as const)('parses portable one-line marker %s', (source, expected) => {
    expect(parseRoxBlockMarker(source)).toEqual(expected)
  })

  it.each([
    '',
    '[!spoiler] Title',
    '[!spoiler]~ Title',
    '[!note]- Title',
    'prefix [!spoiler]- Title',
    '[!spoiler]- Title\nbody',
    '[!spoiler]- Title\rbody',
  ])('rejects malformed or multiline values', source => {
    expect(parseRoxBlockMarker(source)).toBeNull()
    expect(isRoxBlockMarker(source)).toBe(false)
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
    expect(target?.bodyChildren).toHaveLength(1)
    // The editable presentation consists of a toggle widget plus a body-hide
    // decoration while the marker is collapsed. `toDOM` stays lazy, so this is
    // deterministic in Bun without a browser DOM.
    expect(buildRoxBlockDecorations(state).find()).toHaveLength(3)

    const view = {
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
})
