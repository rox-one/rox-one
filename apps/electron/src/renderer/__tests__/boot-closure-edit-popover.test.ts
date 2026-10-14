/**
 * Boot-closure split: AppShell statically imported EditPopover for context-menu
 * edits (statuses/labels/views/add-source/…) and kept every instance mounted
 * while closed (`open={editPopoverOpen === '…'}`). A closed Radix Popover
 * still evaluates the 1.1k-line module (inline ChatDisplay host, motion,
 * GripHorizontal). Mount only when `editPopoverOpen` is set.
 *
 * SkillsListPanel / SourcesListPanel / FreeFormInput also static-imported the
 * same module for empty-state / add-label triggers. `getEditConfig` lives in
 * `edit-config.ts` so those hosts can keep the registry without the UI.
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

describe('closed EditPopover stays out of the boot closure', () => {
  it('AppShell lazy-loads EditPopover and mounts it only when open', () => {
    const appShell = read('components/app-shell/AppShell.tsx')
    const staticImports = staticImportLines(appShell)
    expect(staticImports).not.toMatch(/from\s+['"]@\/components\/ui\/EditPopover['"]/)
    expect(appShell).toContain("import(\"@/components/ui/EditPopover\")")
    expect(appShell).toMatch(/editPopoverOpen\s+&&/)
    expect(staticImports).toMatch(/from\s+['"]@\/components\/ui\/edit-config['"]/)
  })

  it('edit-config is a leaf: no EditPopover / radix / motion imports', () => {
    const src = read('components/ui/edit-config.ts')
    const staticImports = staticImportLines(src)
    expect(staticImports).not.toMatch(/EditPopover|popover|deferred-motion|lucide-react|ChatDisplay/)
    expect(src).toContain('export function getEditConfig')
  })

  it('boot list hosts and FreeFormInput do not statically import EditPopover', () => {
    for (const rel of [
      'components/app-shell/SkillsListPanel.tsx',
      'components/app-shell/SourcesListPanel.tsx',
      'components/app-shell/input/FreeFormInput.tsx',
    ] as const) {
      const src = read(rel)
      const staticImports = staticImportLines(src)
      expect(staticImports).not.toMatch(/from\s+['"]@\/components\/ui\/EditPopover['"]/)
      expect(src).toContain("import('@/components/ui/EditPopover')")
      expect(staticImports).toMatch(/from\s+['"]@\/components\/ui\/edit-config['"]/)
      if (rel.endsWith('FreeFormInput.tsx')) {
        expect(src).toMatch(/addLabelEditConfig\s+&&\s+addLabelPopoverOpen\s+&&/)
      }
    }
  })
})
