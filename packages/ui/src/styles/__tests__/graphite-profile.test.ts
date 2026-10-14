import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(import.meta.dir, '../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..')
const preset = JSON.parse(readFileSync(join(repoRoot, 'apps/electron/resources/themes/rox-graphite.json'), 'utf8'))

describe('Rox Graphite profile', () => {
  it('preset opts into the graphite ui profile with light and dark palettes', () => {
    expect(preset.uiProfile).toBe('graphite')
    expect(preset.supportedModes).toEqual(['light', 'dark'])
    expect(preset.dark.background).toBe('#151517')
  })

  it('scales radius on the DSH set only inside the profile', () => {
    const block = css.match(/html\[data-ui-profile="graphite"\]\s*\{([^}]*)\}/)![1]!
    const SCALE = new Set(['4px', '8px', '12px', '16px', '20px', '24px', '28px'])
    for (const m of block.matchAll(/--radius-(xs|sm|md|lg|xl|2xl|3xl|4xl):\s*([^;]+);/g)) {
      expect(SCALE.has(m[2]!.trim()), `${m[1]} = ${m[2]}`).toBe(true)
    }
    expect(block).toContain('--radius-composer: var(--radius-xl)')
    // Never at :root — other themes keep the default scale.
    const root = css.match(/:root\s*\{([^}]*)\}/g)!.join('')
    expect(root).not.toContain('--graphite-border')
  })

  it('reveals the filled new-session row only in graphite', () => {
    expect(css).toMatch(/html\[data-ui-profile="graphite"\] \[data-sidebar-new-session\]\s*\{\s*display:\s*flex;/)
  })

  it('menu items use concentric radii in graphite only', () => {
    expect(css).toContain('calc(var(--radius-outer) - var(--nest-pad, 4px))')
    for (const m of css.matchAll(/([^{}]*)\{[^{}]*--radius-outer\) - var\(--nest-pad/g)) {
      if (m[1]!.includes('menuitem')) expect(m[1]!.trim().startsWith('html[data-ui-profile="graphite"]')).toBe(true)
    }
  })

  it('a padded screen body owns the inset (no double inset)', () => {
    expect(css).toMatch(/html\[data-ui-profile="graphite"\] \[data-screen-body\] \[data-screen-header\]\s*\{\s*padding:\s*0;/)
    const skills = readFileSync(join(repoRoot, 'apps/electron/src/renderer/pages/SkillsCatalogPage.tsx'), 'utf8')
    expect(skills).toContain('data-screen-body=""')
  })
})
