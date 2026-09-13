import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const rendererRoot = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(rendererRoot, path), 'utf8')

describe('issues 07–09 wiring', () => {
  it('keeps Notes document rails, breadcrumbs and command palette on the real NotesPage', () => {
    const notesPage = read('pages/NotesPage.tsx')
    expect(notesPage).toContain('useNotesRailLayout')
    expect(notesPage).toContain('NotesBreadcrumbs')
    expect(notesPage).toContain('NotesCommandPalette')
    expect(notesPage).toContain('NotesRailSash')
    expect(notesPage).toContain('sanitizePastedMarkdown')
    expect(notesPage).toContain('setHorizontalRule')
    expect(notesPage).toContain('upsertMarkdownComment')
    expect(notesPage).toContain('buildVaultInsights')
    expect(notesPage).toContain('aliasesFromProperties')
    expect(notesPage).toContain('applyLinkSuggestion')
    expect(notesPage).toContain('insertFootnote')
    expect(notesPage).toContain('VaultInsightsPanel')
    expect(notesPage).toContain('getNoteIndexHealth')
    expect(notesPage).toContain('rebuildNoteIndex')
    const inspector = read('pages/notes/NoteInspector.tsx')
    const panel = read('pages/notes/VaultInsightsPanel.tsx')
    expect(inspector).toContain('VaultInsightsPanel')
    expect(inspector).toContain('VaultIndexHealthPanel')
    const health = read('pages/notes/VaultIndexHealthPanel.tsx')
    expect(health).toContain('data-testid="notes-index-health"')
    expect(health).toContain("t('notes.inspector.indexHealth')")
    expect(health).toContain("t('notes.inspector.indexWatching')")
    expect(health).toContain("t('notes.inspector.indexRebuild')")
    expect(panel).toContain("t('notes.inspector.linkSuggestions')")
    expect(panel).toContain("t('notes.inspector.footnotes')")
  })

  it('hosts table, canvas, outline and graph views without replacing Map', () => {
    const notesPage = read('pages/NotesPage.tsx')
    const tabs = read('components/app-shell/EntityViewTabs.tsx')
    expect(tabs).toContain("id: 'table'")
    expect(tabs).toContain("id: 'canvas'")
    expect(notesPage).toContain('<NotesViewHost')
    expect(notesPage).toMatch(/<EntityViewTabs[\s\S]{0,5000}map[\s\S]{0,5000}<MindMapHost/)
  })

  it('exposes Fit/Reset/Run, inspector status and sticky/frame/group chrome on session canvas', () => {
    const editor = read('components/session-workbench/SessionWorkflowEditor.tsx')
    expect(editor).toContain("t('entityView.mapRun')")
    expect(editor).toContain("t('entityView.mapAlign')")
    expect(editor).toContain("data-testid=\"session-canvas-inspector\"")
    expect(editor).toContain("handleCreateChrome('sticky')")
    expect(editor).toContain("handleCreateChrome('frame')")
    expect(editor).toContain("handleCreateChrome('group')")
    expect(editor).toContain('!bg-background/45')
  })
})
