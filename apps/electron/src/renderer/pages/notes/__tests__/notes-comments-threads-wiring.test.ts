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

  it('rail uses reload generation tokens and clears threads on note switch', () => {
    expect(threadsPanel).toContain('reloadGenerationRef')
    expect(threadsPanel).toContain('generation !== reloadGenerationRef.current')
    expect(threadsPanel).toContain('publish([])')
    expect(threadsPanel).toContain('reloadGenerationRef.current += 1')
    expect(threadsPanel).toContain('nestedRoots')
    expect(threadsPanel).toContain('createInFlightRef')
    expect(threadsPanel).toContain('anchorFromQuote(liveText, quote, draftAnchor)')
    expect(threadsPanel).toContain('throw err')
  })

  it('overlay create uses sync in-flight ref and surfaces toast errors', () => {
    expect(notesPage).toContain('commentCreateInFlightRef')
    expect(notesPage).toContain("toast.error(t('notes.comments.errorCreate'))")
  })

  it('CommentsThread awaits onCreate before clearing the reply draft', () => {
    expect(commentsThread).toContain('await create(body, comment.id)')
    expect(commentsThread).toContain('const create = thread.onCreate')
    expect(commentsThread).toContain('void | Promise<void>')
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
