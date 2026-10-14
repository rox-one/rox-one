/**
 * Boot-closure split: AppShell statically imported SendToWorkspaceDialog and
 * CreateProjectDialog, and the boot list panels imported
 * SendResourceToWorkspaceDialog. All three are closed on the first frame
 * (opened from a menu / Add Project / bulk send). A closed Radix Dialog
 * renders nothing, so the modules do not belong in index.html's preloaded
 * graph. Same gate as PublishSessionDialogHost / MessagingDialogHost.
 *
 * `boot-manifest.json` guards the built graph; this is the source-level
 * guard that fails in a plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

function staticImportLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
    .join('\n')
}

describe('closed workspace/project dialogs stay out of the boot closure', () => {
  it('AppShell lazy-loads SendToWorkspaceDialog and CreateProjectDialog', () => {
    const appShell = read('components/app-shell/AppShell.tsx')
    const staticImports = staticImportLines(appShell)
    expect(staticImports).not.toMatch(/from\s+['"]\.\/SendToWorkspaceDialog['"]/)
    expect(staticImports).not.toMatch(/from\s+['"]\.\.\/projects\/CreateProjectDialog['"]/)
    expect(appShell).toContain("import(\"./SendToWorkspaceDialog\")")
    expect(appShell).toContain("import(\"../projects/CreateProjectDialog\")")
    expect(appShell).toContain('sendToWorkspaceIds.length > 0 &&')
    expect(appShell).toContain('createProjectDialogOpen &&')
  })

  it('boot list hosts do not statically import SendResourceToWorkspaceDialog', () => {
    for (const rel of [
      'components/app-shell/MainContentPanel.tsx',
      'components/app-shell/SkillsListPanel.tsx',
      'components/app-shell/SourcesListPanel.tsx',
    ] as const) {
      const src = read(rel)
      const staticImports = staticImportLines(src)
      expect(staticImports).not.toMatch(/SendResourceToWorkspaceDialog[\s\S]*from\s+['"]\.\/SendResourceToWorkspaceDialog['"]/)
      expect(src).toContain("import('./SendResourceToWorkspaceDialog')")
    }
  })
})
