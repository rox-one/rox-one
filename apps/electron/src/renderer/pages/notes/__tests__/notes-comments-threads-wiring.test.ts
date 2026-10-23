import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const threadsPanel = readFileSync(join(import.meta.dir, '../NotesCommentThreads.tsx'), 'utf8')
const commentsThread = readFileSync(join(import.meta.dir, '../../../../../../../packages/ui/src/components/comments/CommentsThread.tsx'), 'utf8')
const dto = readFileSync(join(import.meta.dir, '../../../../../../../packages/shared/src/protocol/dto.ts'), 'utf8')
const noteComments = readFileSync(join(import.meta.dir, '../note-comments.ts'), 'utf8')
const notesRpc = readFileSync(join(import.meta.dir, '../../../../../../../packages/server-core/src/handlers/rpc/notes.ts'), 'utf8')

describe('notes comments threads wiring', () => {
  it('NotesPage mounts NotesCommentThreads when a workspace is active', () => {
    expect(notesPage).toContain('NotesCommentThreads')
    expect(notesPage).toContain('onThreadsChange={setRpcCommentThreads}')
    expect(notesPage).toContain('draftAnchor={commentDraftAnchor}')
    expect(notesPage).toContain('commentDraftOffsetsFromEditor')
    expect(notesPage).toContain('getNoteText={() => contentRef.current}')
  })

  it('NotesPage clears rpcCommentThreads on note/workspace change', () => {
    expect(notesPage).toContain('setRpcCommentThreads([])')
    expect(notesPage).toContain('React.useLayoutEffect')
    expect(notesPage).toContain('[activeWorkspaceId, activeNote?.id]')
    expect(notesPage).toMatch(/Clear highlights before paint/)
  })

  it('overlay create gates listNoteComments setState on still-active note', () => {
    expect(notesPage).toContain('const requestWorkspaceId = activeWorkspaceId')
    expect(notesPage).toContain('const requestNoteId = activeNote.id')
    expect(notesPage).toContain('stillActive')
    expect(notesPage).toContain('workspaceIdRef.current === requestWorkspaceId')
    expect(notesPage).toContain('activeNoteIdRef.current === requestNoteId')
    expect(notesPage).toContain('if (!stillActive()) return')
    expect(notesPage).toContain('tryBeginCommentCreate')
    expect(notesPage).toContain('endCommentCreate')
    expect(notesPage).toContain("toast.error(t('notes.comments.errorCreate'))")
  })

  it('commentDraftOffsetsFromEditor maps selection via buildCommentTextMap', () => {
    expect(notesPage).toContain('pmPosToCommentOffset')
    expect(notesPage).toContain('buildCommentTextMap(handle.state.doc)')
    expect(notesPage).toContain('findQuoteWithContext(markdown, quote, prefix, suffix)')
  })

  it('rail binds publish to note/workspace key and clears on unmount', () => {
    expect(threadsPanel).toContain('activeKeyRef')
    expect(threadsPanel).toContain('isActiveKey')
    expect(threadsPanel).toContain('const requestKey = { workspaceId, noteId }')
    expect(threadsPanel).toContain('if (!isActiveKey(requestKey)) return')
    expect(threadsPanel).toContain('reloadGenerationRef')
    expect(threadsPanel).toContain('generation !== reloadGenerationRef.current')
    expect(threadsPanel).toContain('publish(list, requestKey)')
    expect(threadsPanel).toContain('publishUpdate(requestKey')
    expect(threadsPanel).toContain('onThreadsChangeRef.current?.([])')
    expect(threadsPanel).toContain('clearComposer(requestKey)')
    expect(threadsPanel).toContain('anchorFromQuote(liveText, quote, draftAnchor)')
    expect(threadsPanel).toContain('throw err')
    expect(threadsPanel).toContain('beginCreate')
    expect(threadsPanel).toContain('endCreate(flightToken)')
  })

  it('composers disable while create is in flight', () => {
    expect(threadsPanel).toContain('creating={creating}')
    expect(threadsPanel).toContain('createBusy || busyId === CREATE_BUSY')
    expect(notesPage).toContain('creating={commentCreateBusy}')
    expect(notesPage).toContain('tryBeginCommentCreate')
    expect(notesPage).toContain('endCommentCreate')
    expect(notesPage).toContain('createBusy={commentCreateBusy}')
    expect(notesPage).toContain('beginCreate={() => tryBeginCommentCreate(activeWorkspaceId, activeNote.id)}')
    expect(notesPage).toContain('endCreate={endCommentCreate}')
    // Unique tokens + in-flight note set; note switch must NOT drop in-flight tracking.
    expect(notesPage).toContain('commentCreateFlightsRef')
    expect(notesPage).toContain('commentCreateInFlightNotesRef')
    expect(notesPage).toContain('commentCreateFlightSeqRef')
    expect(notesPage).toContain('commentCreateInFlightNotes.has(activeCommentCreateKey)')
    expect(notesPage).not.toMatch(/useLayoutEffect\([\s\S]*commentCreateFlightsRef/)
    expect(notesPage).not.toMatch(/useLayoutEffect\([\s\S]*commentCreateInFlightNotesRef/)
    const reading = readFileSync(join(import.meta.dir, '../NotesReadingChrome.tsx'), 'utf8')
    expect(reading).toContain('creating = false')
    expect(reading).toContain('disabled={busy || !body.trim()}')
    expect(reading).toContain("if (event.key === 'Escape'")
    expect(reading).toMatch(/if \(busy\)[\s\S]*Escape/)
  })

  it('anchorFromQuote refuses ambiguous quotes without preferred offsets', () => {
    expect(noteComments).toContain('fullText.indexOf(selectedText, start + 1) >= 0')
    expect(noteComments).toContain('return null')
  })

  it('create success clears draft for requestKey even after note switch', () => {
    expect(threadsPanel).toContain('clearComposer(requestKey)')
    expect(notesPage).toContain('clearCommentDraftAt(requestWorkspaceId, requestNoteId)')
    expect(notesPage).toContain('commentCreateFlightsRef')
    expect(notesPage).toMatch(/Markdown-embedded.*highlight-only/s)
  })

  it('orphan roots disable allowReplies', () => {
    expect(threadsPanel).toContain('allowReplies={!readOnly && !root.orphan}')
  })

  it('CommentsThread awaits onCreate/onEdit before closing editors', () => {
    expect(commentsThread).toContain('await create(body, comment.id)')
    expect(commentsThread).toContain('await edit(comment.id, body)')
    expect(commentsThread).toContain('setEditing(false)')
    expect(commentsThread).toContain('Keep the editor open with the draft on failure')
    expect(commentsThread).toContain('void | Promise<void>')
    expect(commentsThread).toContain('setSubmitting(true)')
    expect(commentsThread).toContain('setEditSubmitting(true)')
    expect(commentsThread).toContain('setReplySubmitting(true)')
    expect(commentsThread).toContain('disabled={busy || !value.trim()}')
  })

  it('anchorFromQuote prefers explicit offsets; create ignores client author', () => {
    expect(noteComments).toContain('preferred?: { start: number; end: number }')
    expect(notesRpc).toContain("author: 'Вы'")
    expect(notesRpc).toContain('ignore any client-supplied author')
  })

  it('protocol models optional anchors, parentId, and reaction toggles without client author', () => {
    expect(dto).toContain('parentId?: string')
    expect(dto).toContain('reaction?: { emoji: string }')
    expect(dto).toContain('anchor: NoteCommentAnchor | null')
  })

  it('orphan replies keep parentId and are excluded from document scope', () => {
    expect(noteComments).toContain('orphan: true')
    expect(noteComments).toContain('!comment.orphan')
  })
})
