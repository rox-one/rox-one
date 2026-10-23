import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const panel = readFileSync(join(import.meta.dir, '../VersionHistoryPanel.tsx'), 'utf8')

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
    expect(notesPage).toContain('setContentResolution(previous => previous && previous.status !== \'error\'')
    expect(notesPage).toContain('canonicalRef: { ...previous.canonicalRef, revisionId: saved.revision }')
    expect(notesPage).toContain('onRestore={(revisionId) => restoreNoteFromHistory(revisionId)}')
    // Must not leave the old partial onRestored that only patched content/revision.
    expect(notesPage).not.toContain('onRestored={(note) => {')
  })

  test('VersionHistoryPanel delegates restore to the page callback (no direct racing API call)', () => {
    expect(panel).toContain('onRestore: (revisionId: string) => Promise<unknown>')
    expect(panel).toContain('await onRestore(selectedId)')
    expect(panel).not.toContain('window.electronAPI.restoreNoteRevision')
  })
})
