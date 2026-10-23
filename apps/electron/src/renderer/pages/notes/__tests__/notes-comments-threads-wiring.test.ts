import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const threadsPanel = readFileSync(join(import.meta.dir, '../NotesCommentThreads.tsx'), 'utf8')
const dto = readFileSync(join(import.meta.dir, '../../../../../../../packages/shared/src/protocol/dto.ts'), 'utf8')

describe('notes comments threads wiring', () => {
  it('NotesPage mounts NotesCommentThreads when a workspace is active', () => {
    expect(notesPage).toContain('NotesCommentThreads')
    expect(notesPage).toContain('onThreadsChange={setRpcCommentThreads}')
    expect(notesPage).toContain('noteThreadsToHighlightComments')
    expect(notesPage).toContain('createNoteComment(activeWorkspaceId')
  })

  it('rail exposes resolve, document compose, replies, and reactions on the RPC stack', () => {
    expect(threadsPanel).toContain('updateNoteComment')
    expect(threadsPanel).toContain('resolved: resolvedFlag')
    expect(threadsPanel).toContain("setResolved(root.id, true)")
    expect(threadsPanel).toContain("setResolved(root.id, false)")
    expect(threadsPanel).toContain('notes-comments-document')
    expect(threadsPanel).toContain('onToggleReaction')
    expect(threadsPanel).toContain('CommentsThread')
    expect(threadsPanel).toContain('parentId')
  })

  it('protocol models optional anchors, parentId, and reaction toggles', () => {
    expect(dto).toContain('parentId?: string')
    expect(dto).toContain('NoteCommentReaction')
    expect(dto).toContain("reaction?: { emoji: string; author?: string }")
    expect(dto).toContain('anchor: NoteCommentAnchor | null')
  })
})
