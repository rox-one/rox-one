import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ctx from '../workspace-context'
const { LEGACY_PROJECT_CONTEXT_KEY, clearLegacyProjectContext } = ctx

const shell = readFileSync(join(__dirname, '../../components/app-shell/AppShell.tsx'), 'utf8')
const ctxSrc = readFileSync(join(__dirname, '../workspace-context.ts'), 'utf8')

describe('removed sidebar project context', () => {
  it('clears the saved global scope once on startup', () => {
    const data = new Map([[LEGACY_PROJECT_CONTEXT_KEY, '{"ws":"p1"}'], ['other', 'x']])
    clearLegacyProjectContext({ removeItem: k => { data.delete(k) } })
    expect(data.has(LEGACY_PROJECT_CONTEXT_KEY)).toBe(false)
    expect(data.get('other')).toBe('x')
    expect(() => clearLegacyProjectContext({ removeItem: () => { throw new Error('denied') } })).not.toThrow()
    expect(ctxSrc).not.toContain('atomWithStorage')
  })

  it('retires the shared project atom; no screen reads a hidden shared scope', () => {
    expect('workspaceProjectContextsAtom' in ctx).toBe(false)
    expect('selectedProjectForWorkspaceAtom' in ctx).toBe(false)
    const root = join(__dirname, '../..')
    for (const f of ['components/pages/PagesHome.tsx', 'pages/NotesPage.tsx', 'pages/FeedPage.tsx', 'pages/workspace-work/PlanWorkspacePage.tsx',
      'pages/workspace-work/WorkspaceTasksPage.tsx', 'components/app-shell/AuxiliaryToolPanel.tsx']) {
      expect(readFileSync(join(root, f), 'utf8')).not.toContain('workspaceProjectContextsAtom')
    }
    // Pages keeps its picker local: changing it does not write any cross-screen scope.
    expect(readFileSync(join(root, 'components/pages/PagesHome.tsx'), 'utf8')).toContain('setProjectFilters({ workspaceId: activeWorkspaceId, ids })')
  })

  it('shell never derives a global scope, so chats and new chats/tools stay unfiltered', () => {
    expect(shell).not.toContain('selectedProjectId')
    expect(shell).not.toContain('workspaceProjectContextsAtom')
    expect(shell).not.toContain("const projectId = selectedProjectId ? [selectedProjectId] : undefined")
    expect(shell).not.toContain('workspace-project-context')
    expect(shell).not.toContain("navigation.projectContext")
  })

  it('locales no longer carry navigation.projectContext but keep allProjects', () => {
    for (const loc of ['en', 'ru', 'de']) {
      const json = JSON.parse(readFileSync(join(__dirname, `../../../../../../packages/shared/src/i18n/locales/${loc}.json`), 'utf8'))
      expect(json['navigation.projectContext']).toBeUndefined()
      expect(json['navigation.allProjects']).toBeDefined()
    }
  })
})
