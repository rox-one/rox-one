import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(renderer, path), 'utf8')

describe('continue-visual-3 leftover chrome', () => {
  it('routes notes empty, save, toolbar, and menu chrome through t()', () => {
    const notes = read('pages/NotesPage.tsx')
    expect(notes).toContain("t('notes.empty.selectWorkspace')")
    expect(notes).toContain("t('notes.empty.noNote')")
    expect(notes).toContain("t('notes.empty.noNoteHint')")
    expect(notes).toContain("t('notes.empty.loading')")
    expect(notes).toContain("t('notes.toolbar.previousDaily')")
    expect(notes).toContain("t('notes.toolbar.nextDaily')")
    expect(notes).toContain("t('notes.toolbar.attachAsset')")
    expect(notes).toContain("t('notes.toolbar.exportPdf')")
    expect(notes).toContain("t('notes.save.autosaveHint')")
    expect(notes).toContain("t('notes.menu.newInFolder')")
    expect(notes).toContain("t('notes.menu.reveal')")
    expect(notes).not.toContain('Select a workspace to use notes.')
    expect(notes).not.toContain('No note selected')
    expect(notes).not.toContain('Reveal in Finder')
    expect(notes).not.toContain('title="Previous daily note"')
    expect(notes).not.toContain('Save failed')
  })

  it('uses PremiumMenuSelect for connect-remote workspace picking', () => {
    const source = read('components/workspace/AddWorkspaceStep_ConnectRemote.tsx')
    expect(source).toContain('PremiumMenuSelect')
    expect(source).not.toContain('<Select')
    expect(source).not.toContain("from '../ui/select'")
  })

  it('replaces remaining playground native selects with PremiumMenuSelect', () => {
    const variants = read('playground/VariantsSidebar.tsx')
    const app = read('playground/PlaygroundApp.tsx')
    expect(variants).toContain('PremiumMenuSelect')
    expect(variants).not.toMatch(/<select[\s>]/)
    expect(app).toContain('PremiumMenuSelect')
    expect(app).not.toContain("from '@/components/ui/select'")
  })

  it('translates leftover slash, status, filter, and share chrome', () => {
    const slash = read('components/ui/slash-command-menu.tsx')
    const status = read('components/ui/session-status-menu.tsx')
    const filter = read('components/app-shell/CompactSessionListFilter.tsx')
    const chat = read('pages/ChatPage.tsx')
    const tiptap = readFileSync(join(renderer, '../../../../packages/ui/src/components/markdown/TiptapSlashMenu.ts'), 'utf8')
    expect(slash).toContain("t('commands.noCommands')")
    expect(slash).not.toContain('No commands found')
    expect(tiptap).toContain("i18n.t('commands.noCommands')")
    expect(tiptap).not.toContain('No commands found')
    expect(status).toContain("t('status.noneFound')")
    expect(status).not.toContain('No status found')
    expect(filter).toContain("t('sidebar.noMatches')")
    expect(filter).not.toContain('No matches')
    expect(chat).toContain("t('chat.shareSession')")
    expect(chat).toContain("t('chat.sharedSessionOptions')")
    expect(chat).not.toContain("'Share session'")
  })
})
