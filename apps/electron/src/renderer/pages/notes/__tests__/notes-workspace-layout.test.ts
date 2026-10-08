import { describe, expect, test } from 'bun:test'
import { parseNotesRailLayout, serializeNotesRailLayout } from '../document-ia'
import { maximumNotesRailWidth, notesRailKeyWidth, visibleNotesRails } from '../notes-layout'
import { EMPTY_COMMENT_DRAFT, noteCommentDraftKey, updateCommentDraft } from '../comment-drafts'
import { selectedNoteQuote } from '../comment-highlights'

describe('Notes in a tiled workspace', () => {
  const expanded = parseNotesRailLayout(JSON.stringify({ vault: 240, toc: 180, comments: 220, vaultCollapsed: false, tocCollapsed: false, commentsCollapsed: false }))

  test('new workspaces start with the note list and a quiet document', () => {
    const defaults = parseNotesRailLayout(null)
    expect(visibleNotesRails(defaults, 1000)).toEqual({ vault: true, toc: false, comments: false })
    expect(defaults.vault).toBe(240)
  })

  test('existing explicit expanded preferences still round-trip', () => {
    expect(parseNotesRailLayout(serializeNotesRailLayout(expanded))).toEqual(expanded)
    expect(visibleNotesRails(expanded, 1000)).toEqual({ vault: true, toc: true, comments: true })
  })

  test('four and six tile layouts leave the document readable', () => {
    for (const width of [320, 360, 420, 480, 539]) {
      expect(visibleNotesRails(expanded, width)).toEqual({ vault: false, toc: false, comments: false })
    }
  })

  test('shrinking and expanding never rewrites saved sizes or open preferences', () => {
    const before = serializeNotesRailLayout(expanded)
    expect(visibleNotesRails(expanded, 640)).toEqual({ vault: true, toc: false, comments: false })
    expect(visibleNotesRails(expanded, 820)).toEqual({ vault: true, toc: false, comments: true })
    expect(visibleNotesRails(expanded, 1000)).toEqual({ vault: true, toc: true, comments: true })
    expect(serializeNotesRailLayout(expanded)).toBe(before)
  })

  test('secondary views receive the full working width after the vault', () => {
    expect(visibleNotesRails(expanded, 1400, false)).toEqual({ vault: true, toc: false, comments: false })
  })

  test('all supported rail combinations preserve the document width budget', () => {
    for (const width of [360, 500, 600, 800, 1000, 1400]) {
      for (const vaultCollapsed of [true, false]) {
        for (const tocCollapsed of [true, false]) {
          for (const commentsCollapsed of [true, false]) {
            const preferences = { ...expanded, vaultCollapsed, tocCollapsed, commentsCollapsed }
            const visible = visibleNotesRails(preferences, width)
            const railWidth = (['vault', 'toc', 'comments'] as const).reduce((sum, rail) => sum + (visible[rail] ? preferences[rail] : 0), 0)
            expect(width - railWidth).toBeGreaterThanOrEqual(360)
          }
        }
      }
    }
  })

  test('dragging a rail stops before it hides the editor or another rail', () => {
    const visible = visibleNotesRails(expanded, 1000)
    expect(maximumNotesRailWidth('vault', expanded, 1000, visible)).toBe(240)
    expect(maximumNotesRailWidth('toc', expanded, 1000, visible)).toBe(180)
    expect(maximumNotesRailWidth('comments', expanded, 1000, visible)).toBe(220)
    expect(maximumNotesRailWidth('vault', expanded, 640, visibleNotesRails(expanded, 640))).toBe(280)
  })

  test('keyboard resize supports coarse movement, bounds, and the right rail direction', () => {
    expect(notesRailKeyWidth(240, 'ArrowRight')).toBe(250)
    expect(notesRailKeyWidth(240, 'ArrowLeft', false, true)).toBe(200)
    expect(notesRailKeyWidth(220, 'ArrowLeft', true)).toBe(230)
    expect(notesRailKeyWidth(220, 'ArrowRight', true, true)).toBe(180)
    expect(notesRailKeyWidth(140, 'ArrowLeft')).toBe(140)
    expect(notesRailKeyWidth(480, 'ArrowRight')).toBe(480)
    expect(notesRailKeyWidth(240, 'Home')).toBe(140)
    expect(notesRailKeyWidth(240, 'End')).toBe(480)
    expect(notesRailKeyWidth(240, 'Tab')).toBeNull()
  })
})

describe('Unsent note comments', () => {
  test('selection in another tile cannot become this note’s quote', () => {
    const ownNode = {} as Node
    const siblingNode = {} as Node
    const editor = { contains: (node: Node | null) => node === ownNode }
    expect(selectedNoteQuote(editor, { anchorNode: ownNode, focusNode: ownNode, toString: () => ' Selected text ' })).toBe('Selected text')
    expect(selectedNoteQuote(editor, { anchorNode: siblingNode, focusNode: siblingNode, toString: () => 'Another document' })).toBe('')
    expect(selectedNoteQuote(editor, { anchorNode: ownNode, focusNode: siblingNode, toString: () => 'Across documents' })).toBe('')
    expect(selectedNoteQuote(editor, null)).toBe('')
  })

  test('note and workspace changes cannot retarget a draft', () => {
    const a = noteCommentDraftKey('workspace-a', 'daily/today')!
    const b = noteCommentDraftKey('workspace-a', 'projects/review')!
    const c = noteCommentDraftKey('workspace-b', 'daily/today')!
    let drafts = updateCommentDraft(new Map(), a, { quote: 'Selected text', body: 'Unsent thought' })
    drafts = updateCommentDraft(drafts, b, { quote: 'Other text', body: 'Another thought' })
    drafts = updateCommentDraft(drafts, c, { quote: 'Different vault' })
    expect(drafts.get(a)).toEqual({ quote: 'Selected text', body: 'Unsent thought' })
    expect(drafts.get(b)?.body).toBe('Another thought')
    expect(drafts.get(c)?.body).toBe('')
  })

  test('moving a draft between the inline composer and sheet preserves both fields', () => {
    const key = noteCommentDraftKey('workspace', 'note')!
    const drafts = updateCommentDraft(new Map(), key, { quote: 'Text', body: 'Draft' })
    const afterSelection = updateCommentDraft(drafts, key, { quote: 'Longer text' })
    expect(afterSelection.get(key)).toEqual({ quote: 'Longer text', body: 'Draft' })
    expect(drafts.get(key)?.quote).toBe('Text')
    expect(updateCommentDraft(afterSelection, key, EMPTY_COMMENT_DRAFT).has(key)).toBe(false)
  })

  test('no note cannot create a draft and compound paths do not collide', () => {
    const drafts = new Map()
    expect(updateCommentDraft(drafts, noteCommentDraftKey(null, 'note'), { body: 'Draft' })).toBe(drafts)
    expect(noteCommentDraftKey('a/b', 'c')).not.toBe(noteCommentDraftKey('a', 'b/c'))
  })
})
