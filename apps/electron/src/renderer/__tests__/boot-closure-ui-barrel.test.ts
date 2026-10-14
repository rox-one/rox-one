/**
 * Boot-closure split: 25 modules in index.html's preloaded graph still imported
 * `{ Spinner | Tooltip | PremiumMenu | DropdownMenu | Markdown | parseAnsi |
 * usePlatform }` from the `@rox/ui` barrel. Evaluating that barrel pulls the
 * primitives index (`Island` → `motion`/`framer-motion`, `BrowserControls`,
 * `StyledDropdown`) into the shared chunk — 324 KB leftover after #1957,
 * named `audio-transcript-actions-*.js` only because Vite names chunks by
 * composition.
 *
 * Leaf paths (`@rox/ui/spinner`, `@rox/ui/tooltip`, …) skip the barrel.
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

const BOOT_BARREL_FILES = [
  'components/app-shell/AppShell.tsx',
  'components/app-shell/PanelWorkspaceMenu.tsx',
  'components/app-shell/SessionItem.tsx',
  'components/app-shell/SessionLanes.tsx',
  'components/app-shell/SessionSearchHeader.tsx',
  'components/app-shell/TerminalPanel.tsx',
  'components/app-shell/TopBar.tsx',
  'components/app-shell/collection/CollectionBulkMenu.tsx',
  'components/app-shell/collection/CollectionGroupByMenu.tsx',
  'components/app-shell/input/FreeFormInputContextBadge.tsx',
  'components/app-shell/input/VoiceDictationControl.tsx',
  'components/browser/BrowserTabGlyph.tsx',
  'components/markdown/StreamingMarkdown.tsx',
  'components/markdown/index.ts',
  'components/session-inspector/InspectorTerminal.tsx',
  'components/ui/EditPopover.tsx',
  'components/ui/HeaderIconButton.tsx',
  'components/ui/PanelHeaderCenterButton.tsx',
  'components/ui/entity-list-badge.tsx',
  'components/ui/premium-menu.tsx',
  'components/ui/source-status-indicator.tsx',
  'platform/GlobalCreateMenu.tsx',
  'platform/InspectorActionRail.tsx',
  'platform/InspectorHost.tsx',
  'platform/ModeBar.tsx',
  'platform/RailRow.tsx',
] as const

describe('boot-reachable renderer files do not import the @rox/ui barrel', () => {
  it('each known boot importer uses a leaf path instead', () => {
    const barrel = /from ['"]@rox\/ui['"]/
    const offenders: string[] = []
    for (const rel of BOOT_BARREL_FILES) {
      if (barrel.test(read(rel))) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('leaf paths cover the symbols those files actually use', () => {
    expect(read('components/app-shell/SessionItem.tsx')).toContain("from \"@rox/ui/spinner\"")
    expect(read('components/app-shell/AppShell.tsx')).toContain('from "@rox/ui/tooltip"')
    expect(read('components/ui/premium-menu.tsx')).toContain("from '@rox/ui/premium-menu'")
    expect(read('platform/GlobalCreateMenu.tsx')).toContain("from '@rox/ui/dropdown-menu'")
    expect(read('components/markdown/StreamingMarkdown.tsx')).toContain("from '@rox/ui/markdown'")
    expect(read('components/markdown/index.ts')).toContain("from '@rox/ui/markdown'")
    expect(read('components/session-inspector/InspectorTerminal.tsx')).toContain("from '@rox/ui/ansi-parser'")
    expect(read('components/ui/EditPopover.tsx')).toContain("from '@rox/ui/context'")
  })
})
