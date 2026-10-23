import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const threadsPanel = readFileSync(join(import.meta.dir, '../NotesCommentThreads.tsx'), 'utf8')
const dto = readFileSync(join(import.meta.dir, '../../../../../../../packages/shared/src/protocol/dto.ts'), 'utf8')
const noteComments = readFileSync(join(import.meta.dir, '../note-comments.ts'), 'utf8')

describe('notes comments threads wiring', () => {
  it('NotesPage mounts NotesCommentThreads when a workspace is active', () => {
    expect(notesPage).toContain('NotesCommentThreads')
    expect(notesPage).toContain('onThreadsChange={setRpcCommentThreads}')
    expect(notesPage).toContain('noteThreadsToHighlightComments')
    expect(notesPage).toContain('getNoteText={() => contentRef.current}')
    expect(notesPage).toContain('createNoteComment(activeWorkspaceId')
  })

  it('rail uses functional updates, quiet reload, create busy, and comments events', () => {
    expect(threadsPanel).toContain('upsertNoteCommentInList')
    expect(threadsPanel).toContain('removeNoteCommentFromList')
    expect(threadsPanel).toContain('setComments(prev =>')
    expect(threadsPanel).toContain('reload({ quiet: true })')
    expect(threadsPanel).toContain("onNotesChanged")
    expect(threadsPanel).toContain("reason !== 'comments'")
    expect(threadsPanel).toContain('CREATE_BUSY')
    expect(threadsPanel).toContain('getNoteText()')
    expect(threadsPanel).toContain('anchorFromQuote(liveText, quote)')
  })

  it('protocol models optional anchors, parentId, and reaction toggles without client author', () => {
    expect(dto).toContain('parentId?: string')
    expect(dto).toContain('NoteCommentReaction')
    expect(dto).toContain('reaction?: { emoji: string }')
    expect(dto).not.toContain('reaction?: { emoji: string; author?: string }')
    expect(dto).toContain('anchor: NoteCommentAnchor | null')
  })

  it('orphan replies keep parentId and are excluded from document scope', () => {
    expect(noteComments).toContain('orphan: true')
    expect(noteComments).toContain('!comment.orphan')
    expect(noteComments).toContain('upsertNoteCommentInList')
  })
})
