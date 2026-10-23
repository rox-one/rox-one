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

describe('Docs step 6 — share link enforcement in NotesPage', () => {
  it('validates the token before opening and opens nothing on rejection', () => {
    const start = page.indexOf('resolveNoteShareLink(')
    expect(start).toBeGreaterThan(-1)
    const block = page.slice(start, start + 700)
    expect(block).toContain("toast.error(t('notes.share.linkRejected')")
    expect(block.indexOf('return')).toBeLessThan(block.indexOf('openNote(noteId)'))
  })
  it('view role makes the editor non-editable and short-circuits every write path', () => {
    expect(page).toContain('&& !shareReadOnly')
    expect(page).toContain('editable={canEditContent}')
    expect(page.match(/noteShareBlocksWrite\(shareAccessRef\.current/g)?.length).toBeGreaterThanOrEqual(3)
    expect(page).toContain('data-testid="notes-share-view-only"')
  })
  it('dialog states the link only works on devices with this vault', () => {
    expect(dialog).toContain("t('notes.share.deviceOnlyHint')")
  })
})
