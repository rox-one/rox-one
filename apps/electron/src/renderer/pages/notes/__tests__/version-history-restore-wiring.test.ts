import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const panel = readFileSync(join(import.meta.dir, '../VersionHistoryPanel.tsx'), 'utf8')
const notesRpc = readFileSync(
  join(import.meta.dir, '../../../../../../../packages/server-core/src/handlers/rpc/notes.ts'),
  'utf8',
)

describe('version history restore wiring', () => {
  test('NotesPage restores through the save queue after flush and applies full revision maps', () => {
    expect(notesPage).toContain('const restoreNoteFromHistory = React.useCallback')
    expect(notesPage).toContain('if (!await flushBeforeAction())')
    expect(notesPage).toContain('saveQueueRef.current.then')
    expect(notesPage).toContain('pendingCommitsRef.current.delete(revisionKey)')
    expect(notesPage).toContain('window.electronAPI.restoreNoteRevision')
    expect(notesPage).toContain('revisionsRef.current.set(revisionKey, saved.revision)')
    expect(notesPage).toContain('expectedRevisionByNoteRef.current.set(revisionKey, contentHash(saved.content))')
    expect(notesPage).toContain('nativeRevisionByNoteRef.current.set(revisionKey, saved.nativeRevision ?? null)')
    expect(notesPage).toContain('onRestore={(revisionId) => restoreNoteFromHistory(revisionId)}')
    expect(notesPage).not.toContain('onRestored={(note) => {')
  })

  test('NotesPage re-resolves content after restore so prior error does not leave canEdit false', () => {
    expect(notesPage).toContain('Rebuild content resolution after restore')
    expect(notesPage).toContain('restoredResolution = await window.electronAPI.resolveContent')
    expect(notesPage).toContain('...restoredResolution')
    expect(notesPage).toContain('setContentResolution({')
  })

  test('VersionHistoryPanel keys and selects by operationId; restore/get use revisionId', () => {
    expect(panel).toContain('key={entry.operationId}')
    expect(panel).toContain('setSelectedId(entry.operationId)')
    expect(panel).toContain('entry.operationId === selectedId')
    expect(panel).toContain('setSelectedId(list[0].operationId)')
    expect(panel).toContain('await onRestore(selectedEntry.revisionId)')
    expect(panel).toContain('getNoteRevision(workspaceId, noteId, selectedEntry.revisionId)')
    expect(panel).not.toContain('key={entry.revisionId}')
    expect(panel).not.toContain('window.electronAPI.restoreNoteRevision')
  })

  test('notes RPC reuses the commit operationId for rememberSavedNoteRevision', () => {
    expect(notesRpc).toContain('const markdownSaveOperationId = crypto.randomUUID()')
    expect(notesRpc).toContain('operationId: markdownSaveOperationId')
    expect(notesRpc).toContain('const markdownRestoreOperationId = crypto.randomUUID()')
    expect(notesRpc).toContain('operationId: markdownRestoreOperationId')
    expect(notesRpc).toContain('operationId: commitOperation.operationId')
    expect(notesRpc).toContain('operationId: nativeOperation(operation).operationId')
    // Must not mint a fresh UUID only for the sidecar remember on markdown paths.
    const markdownRememberBlocks = notesRpc.split('rememberSavedNoteRevision').slice(1)
    for (const block of markdownRememberBlocks) {
      const head = block.slice(0, 350)
      if (head.includes('markdownSaveOperationId') || head.includes('markdownRestoreOperationId')
        || head.includes('commitOperation.operationId') || head.includes('nativeOperation(operation)')) {
        expect(head).not.toMatch(/operationId:\s*crypto\.randomUUID\(\)/)
        expect(head).not.toMatch(/operationId:\s*randomUUID\(\)/)
      }
    }
  })
})
