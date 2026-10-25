import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const dialog = readFileSync(join(import.meta.dir, '../NoteShareDialog.tsx'), 'utf8')

describe('Docs step 6 — note share wiring', () => {
  it('NotesPage exposes a toolbar Share button that opens NoteShareDialog for the active note', () => {
    expect(page).toContain('data-testid="notes-share-open"')
    expect(page).toContain('setShareDialogOpen(true)')
    expect(page).toContain('<NoteShareDialog')
    expect(page).toContain("noteId={activeNote?.id ?? null}")
  })

  it('dialog persists through the local notes share IPC with view/edit roles', () => {
    expect(dialog).toContain('window.electronAPI.getNoteShare(')
    expect(dialog).toContain('window.electronAPI.updateNoteShare(')
    expect(dialog).toContain('NOTE_SHARE_ROLES')
    expect(dialog).toContain("from '@rox/core/docs'")
  })

  it('uses package exports and SE surface tokens only', () => {
    expect(dialog).not.toMatch(/from '(\.\.\/)+.*core\/src/)
    expect(dialog).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(dialog).not.toContain('bg-foreground/[')
    expect(dialog).toContain('bg-surface-hover')
    expect(dialog).toContain('bg-surface-selected')
  })

  it('stays local: no realtime collab or remote invite service', () => {
    expect(dialog).not.toMatch(/yjs|y-prosemirror|fetch\(/i)
  })
})

const history = readFileSync(join(import.meta.dir, '../VersionHistoryPanel.tsx'), 'utf8')
const rail = readFileSync(join(import.meta.dir, '../NotesCommentThreads.tsx'), 'utf8')

/** Source slice starting at `marker`, `length` chars — one guarded function. */
function slice(src: string, marker: string, length = 600): string {
  const at = src.indexOf(marker)
  expect(at, `missing ${marker}`).toBeGreaterThan(-1)
  return src.slice(at, at + length)
}

const SHARE_GUARD = 'noteShareBlocksWrite(shareAccessRef.current'

describe('Docs step 6 — share link enforcement in NotesPage', () => {
  it('validates the token before opening; rejection toasts, clears the route, opens nothing', () => {
    const block = slice(page, 'resolveNoteShareLink(', 900)
    expect(block).toContain("toast.error(t('notes.share.linkRejected')")
    expect(block).toContain('navigate(routes.view.notes())')
    expect(block.indexOf('navigate(routes.view.notes())')).toBeLessThan(block.indexOf('openNote(noteId)'))
  })
  it('view role makes the editor non-editable', () => {
    expect(page).toContain('&& !shareReadOnly')
    expect(page).toContain('editable={canEditContent}')
    expect(page).toContain('data-testid="notes-share-view-only"')
  })
  it('saveCurrentNote never saves in a view session', () => {
    expect(slice(page, 'const saveCurrentNote = React.useCallback', 300)).toContain(SHARE_GUARD)
  })
  it('restoreNoteFromHistory throws read-only; panel hides restore', () => {
    const fn = slice(page, 'const restoreNoteFromHistory = React.useCallback', 400)
    expect(fn).toContain(SHARE_GUARD)
    expect(fn).toContain("t('notes.content.readOnly')")
    expect(slice(page, 'onRestore={(revisionId) => restoreNoteFromHistory(revisionId)}', 120)).toContain('readOnly={shareReadOnly}')
    expect(history).toContain('{!readOnly && <Button')
    expect(slice(history, 'const restore = React.useCallback', 120)).toContain('if (readOnly ||')
  })
  it('importFiles bails in a view session', () => {
    expect(slice(page, 'const importFiles = React.useCallback', 250)).toContain(SHARE_GUARD)
  })
  it('paste and drop (incl. script-sanitize insert) bail when not editable', () => {
    const paste = slice(page, 'onPasteCapture={(event) => {', 400)
    expect(paste.indexOf('if (!canEditContent)')).toBeGreaterThan(-1)
    expect(paste.indexOf('if (!canEditContent)')).toBeLessThan(paste.indexOf('insertContent') === -1 ? Infinity : paste.indexOf('insertContent'))
    expect(slice(page, 'onDropCapture={(event) => {', 200)).toContain('if (!canEditContent)')
  })
  it('comment submit bails and the rail is read-only', () => {
    expect(slice(page, 'onSubmit={() => {\n                    const text = commentComposerBody.trim()', 400)).toContain(SHARE_GUARD)
    expect(page).toContain('readOnly={shareReadOnly}\n')
    for (const fn of ['createRoot', 'onCreate', 'onEdit', 'onDelete', 'onToggleReaction', 'setResolved']) {
      expect(slice(rail, `const ${fn} = React.useCallback(async`, 160), fn).toContain('if (readOnlyRef.current) return')
    }
  })
  it('applyMarkers returns early when not editable', () => {
    expect(slice(page, 'const applyMarkers = async () => {', 200)).toContain('|| !canEditContent) return')
  })
  it('task toggles and property edits are guarded', () => {
    expect(slice(page, 'const toggleTask = async', 200)).toContain(SHARE_GUARD)
    expect(slice(page, 'const editTableCell = React.useCallback', 300)).toContain(SHARE_GUARD)
  })
  it('dialog states the link only works on devices with this vault', () => {
    expect(dialog).toContain("t('notes.share.deviceOnlyHint')")
  })
})
