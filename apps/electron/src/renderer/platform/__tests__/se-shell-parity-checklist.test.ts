import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Locks Rox Engineering shell parity checklist claims that are DONE,
 * especially pointwise popover blur. Remaining gaps live in the JSON only.
 */

const root = join(import.meta.dir, '../../../../../..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const checklistPath = join(root, 'docs/design/se-shell-parity-checklist.md')
const contractPath = join(root, 'docs/design/se-shell-parity-contract.json')
const material = strip(readFileSync(join(root, 'packages/ui/src/styles/tokens/material.css'), 'utf8'))
const skin = strip(readFileSync(join(root, 'packages/ui/src/components/glass/arc-glass-skin.css'), 'utf8'))
const ui = strip(readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8'))
const renderer = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const preset = JSON.parse(
  readFileSync(join(root, 'apps/electron/resources/themes/super-engineering.json'), 'utf8'),
)

const slottedSurfaces = [
  'apps/electron/src/renderer/components/ui/popover.tsx',
  'apps/electron/src/renderer/components/ui/dropdown-menu.tsx',
  'apps/electron/src/renderer/components/ui/context-menu.tsx',
  'packages/ui/src/components/ui/StyledDropdown.tsx',
  'packages/ui/src/components/ui/PremiumMenu.tsx',
  'packages/ui/src/components/ui/SimpleDropdown.tsx',
  'packages/ui/src/components/ui/FilterableSelectPopover.tsx',
]

describe('SE shell parity checklist (docs + contract)', () => {
  it('ships checklist + contract with named remaining gaps', () => {
    expect(existsSync(checklistPath)).toBe(true)
    expect(existsSync(contractPath)).toBe(true)
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as {
      profile: string
      gaps: Array<{ id: string }>
      done: Array<{ id: string }>
    }
    expect(contract.profile).toBe('super-engineering')
    expect(contract.done.some((d) => d.id === 'popover-blur-accents')).toBe(true)
    expect(contract.gaps.map((g) => g.id).sort()).toEqual(['G4', 'G5'])
    const md = readFileSync(checklistPath, 'utf8')
    expect(md).toContain('do not re-PR')
    expect(md).toContain('Remaining gaps')
    for (const id of ['G4', 'G5']) expect(md).toContain(id)
    expect(md).toContain('Workspace navigator design width')
    expect(contract.done.some((d) => d.id === 'icons-se-v2')).toBe(true)
    expect(md).toContain('Optional icons v2 SVG extract')
    expect(contract.done.some((d) => d.id === 'worktree-hover-delay')).toBe(true)
    expect(contract.done.some((d) => d.id === 'dialog-popover-springs')).toBe(true)
    expect(contract.done.some((d) => d.id === 'navigator-width-260')).toBe(true)
  })
})

describe('SE pointwise popover blur (already correct — lock)', () => {
  it('preset stays Rox Engineering with glass accents default off', () => {
    expect(preset.name).toBe('Rox Engineering')
    expect(preset.uiProfile).toBe('super-engineering')
    expect(preset.layers?.glass ?? 0).toBe(0)
  })

  it('SE chrome plate blur is 20px (feeds --chrome-glass-blur)', () => {
    expect(ui).toMatch(
      /html\[data-ui-profile="super-engineering"\]\s*\{[^}]*--chrome-plate-blur:\s*20px;/,
    )
  })

  it('SE accents fix popover blur at 20px (not intensity-scaled)', () => {
    expect(material).toMatch(
      /html\[data-ui-profile="super-engineering"\]\[data-glass-accents\][^{]*\{[\s\S]*?--glass-blur:\s*20px;/,
    )
    expect(material).not.toMatch(
      /html\[data-ui-profile="super-engineering"\]\[data-glass-accents\][\s\S]*?--glass-blur:\s*calc\(20px \* var\(--glass-intensity\)/,
    )
  })

  it('skin paints backdrop blur on slotted popovers; solid under basic / reduced-transparency', () => {
    expect(skin).toMatch(
      /html\[data-ui-profile="super-engineering"\]\[data-glass-accents\]\s*:is\(\.rox-mode-pill,\s*\[data-glass-slot="popover"\],\s*\[data-glass-slot="mini-button"\]\)/,
    )
    expect(skin).toMatch(
      /backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturate\)\);\s*-webkit-backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturate\)\);/,
    )
    expect(skin).toMatch(
      /html\[data-ui-profile="super-engineering"\]\[data-glass-accents\]\[data-glass="basic"\][\s\S]*?\[data-glass-slot="popover"\][\s\S]*?--glass-blur:\s*0px/,
    )
    expect(skin).toContain('@media (prefers-reduced-transparency: reduce)')
    // No refraction on floating popovers.
    for (const block of skin.split('}').filter((r) => r.includes('url(#rox-glass-skin-refraction)'))) {
      expect(block).not.toMatch(/popover|menu/)
    }
  })

  it('renderer exempts slotted SE menus only when accents are on', () => {
    expect(renderer).toContain(
      'html:not([data-ui-profile="super-engineering"][data-glass-accents]) :is(',
    )
    expect(renderer).toContain('[data-slot="dropdown-menu-content"]:not([data-glass-slot="popover"])')
    expect(renderer).toContain('[role="menu"]:not([data-glass-slot="popover"])')
  })

  it('shared shell + ui menu surfaces carry data-glass-slot="popover"', () => {
    for (const rel of slottedSurfaces) {
      const src = readFileSync(join(root, rel), 'utf8')
      expect(src).toContain('data-glass-slot="popover"')
    }
  })
})

describe('SE shell parity remaining / closed gaps', () => {
  it('G1 DONE: packages/ui/src/icons/se extract ships v2 stroke 1.5', () => {
    const seDir = join(root, 'packages/ui/src/icons/se')
    expect(existsSync(seDir)).toBe(true)
    const index = readFileSync(join(seDir, 'index.ts'), 'utf8')
    expect(index).toContain('SE_ICON_LAYER_VERSION = 2')
    expect(index).toContain('FolderGit2')
    expect(index).toContain('GitBranch')
    expect(index).toContain('GitPullRequest')
    expect(index).toContain('CircleCheck')
    const create = readFileSync(join(seDir, 'createSeIcon.tsx'), 'utf8')
    expect(create).toContain('SE_ICON_STROKE = 1.5')
    const stub = readFileSync(
      join(root, 'apps/electron/src/renderer/components/icons/se/index.ts'),
      'utf8',
    )
    expect(stub).toContain("from '@rox/ui/icons/se'")
    const nav = readFileSync(
      join(root, 'apps/electron/src/renderer/components/workspace/WorkspaceNavigator.tsx'),
      'utf8',
    )
    expect(nav).toContain("from '@rox/ui/icons/se'")
    expect(nav).not.toMatch(/from 'lucide-react'/)
  })

  it('G3 DONE: NAVIGATOR_WIDTH_DEFAULT is 260 (spec left_sidebar_width_design)', () => {
    const prefs = readFileSync(
      join(root, 'apps/electron/src/renderer/lib/shell-layout-preferences.ts'),
      'utf8',
    )
    expect(prefs).toMatch(/export const NAVIGATOR_WIDTH_DEFAULT = 260\b/)
    expect(prefs).toMatch(/export const NAVIGATOR_WIDTH_MIN = 240\b/)
    expect(prefs).toMatch(/export const NAVIGATOR_WIDTH_MAX = 480\b/)
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as {
      done: Array<{ id: string }>
      gaps: Array<{ id: string }>
    }
    expect(contract.done.some((d) => d.id === 'navigator-width-260')).toBe(true)
    expect(contract.gaps.map((g) => g.id)).not.toContain('G3')
    const md = readFileSync(checklistPath, 'utf8')
    expect(md).toContain('NAVIGATOR_WIDTH_DEFAULT = 260')
    expect(md).not.toMatch(/\| G3 \|/)
  })

  it('G2 DONE: WorkspaceNavigator gates WorktreeHoverCard at 250ms', () => {
    const nav = readFileSync(
      join(root, 'apps/electron/src/renderer/components/workspace/WorkspaceNavigator.tsx'),
      'utf8',
    )
    expect(nav).toContain('export const WORKTREE_HOVER_DELAY_MS = 250')
    expect(nav).toMatch(/setTimeout\([^,]+,\s*WORKTREE_HOVER_DELAY_MS\)/)
    expect(nav).toContain("layout === 'compact' && hoverBranch?.id === branch.id")
  })
})
