import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const threadsPanel = readFileSync(join(import.meta.dir, '../NotesCommentThreads.tsx'), 'utf8')
const commentsThread = readFileSync(join(import.meta.dir, '../../../../../../../packages/ui/src/components/comments/CommentsThread.tsx'), 'utf8')
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

  it('rail uses functional publish, quiet reload without wipe, createInFlightRef, and empty fragment composer', () => {
    expect(threadsPanel).toContain('publishUpdate')
    expect(threadsPanel).toContain('upsertNoteCommentInList')
    expect(threadsPanel).toContain('removeNoteCommentFromList')
    expect(threadsPanel).toContain('reload({ quiet: true })')
    expect(threadsPanel).toContain('if (!quiet) publish([])')
    expect(threadsPanel).toContain('createInFlightRef')
    expect(threadsPanel).toContain('createInFlightRef.current = true')
    expect(threadsPanel).toContain('onNotesChanged')
    expect(threadsPanel).toContain("reason !== 'comments'")
    expect(threadsPanel).toContain('renderComposer={() => <></>}')
    expect(threadsPanel).toContain('getNoteText()')
  })

  it('overlay create uses sync in-flight ref and surfaces toast errors', () => {
    expect(notesPage).toContain('commentCreateInFlightRef')
    expect(notesPage).toContain('commentCreateInFlightRef.current = true')
    expect(notesPage).toContain("toast.error(t('notes.comments.errorCreate'))")
    expect(notesPage).toContain("toast.error(t('notes.comments.errorAttachSelection'))")
  })

  it('CommentsThread treats explicit null renderComposer as suppress, not TextComposer fallback', () => {
    expect(commentsThread).toContain('slot === undefined')
    expect(commentsThread).not.toContain('renderComposer?.(composerProps) ??')
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
