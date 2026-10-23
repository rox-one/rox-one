import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const themeTs = readFileSync(join(root, 'packages/shared/src/config/theme.ts'), 'utf8')
const input = readFileSync(
  join(root, 'apps/electron/src/renderer/components/ui/input.tsx'),
  'utf8',
)
const search = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/SessionSearchHeader.tsx'),
  'utf8',
)
const filterMenu = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/collection/CollectionFilterMenu.tsx'),
  'utf8',
)
const preset = JSON.parse(
  readFileSync(join(root, 'apps/electron/resources/themes/super-engineering.json'), 'utf8'),
)

const marker = '/* Rox Engineering shared shell Input / search / filter chrome.'
const endMarker = '/* Rox Engineering mode-pill density'
const start = css.indexOf(marker)
const end = css.indexOf(endMarker, start)
const seBlock = start < 0 ? '' : css.slice(start, end < 0 ? start + 1200 : end)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE shared shell input surface (canon #1a1a1e → --input-surface)', () => {
  it('preset input token is #1a1a1e under Rox Engineering', () => {
    expect(preset.name).toBe('Rox Engineering')
    expect(preset.uiProfile).toBe('super-engineering')
    expect(preset.input).toBe('#1a1a1e')
    expect(preset.dark?.input).toBe('#1a1a1e')
  })

  it('themeToCSS maps theme.input to --input-surface (not the border --input alias)', () => {
    expect(themeTs).toContain('vars.push(`--input-surface: ${colors.input || bg};`)')
    expect(themeTs).toMatch(/input:\s*'input-surface'/)
  })

  it('packages/ui aliases --surface-input to --input-surface', () => {
    expect(ui).toMatch(/--surface-input:\s*var\(--input-surface\)/)
  })

  it('shared Input uses bg-surface-input', () => {
    expect(input).toContain('bg-surface-input')
    expect(input).toContain('data-slot="input"')
    expect(input).toContain('focus-visible:ring-focus/25')
  })

  it('SessionSearchHeader shell search chrome uses surface-input + control radius', () => {
    expect(search).toContain('data-slot="shell-search"')
    expect(search).toContain('bg-surface-input')
    expect(search).toContain('rounded-[var(--radius-control)]')
    expect(search).toContain('has-[:focus-visible]:border-focus')
    expect(search).toContain('has-[:focus-visible]:ring-focus/25')
    expect(search).not.toContain('bg-muted/50')
    expect(search).not.toContain('has-[:focus-visible]:bg-background')
  })

  it('CollectionFilterMenu shell filter fields use surface-input', () => {
    expect(filterMenu).toContain('bg-surface-input')
    expect(filterMenu).toContain('data-slot="shell-search-input"')
    expect(filterMenu).not.toContain('bg-foreground/[0.03]')
  })

  it('SE CSS pins shell-search to --input-surface and accent focus (#2211)', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBare).toContain('[data-slot="shell-search"]')
    expect(seBare).toContain('background: var(--input-surface)')
    expect(seBare).toContain('box-shadow: var(--se-shell-focus-ring)')
    expect(seBare).toContain('var(--focus, var(--accent))')
    expect(seBare).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('SE high-contrast shell-search keeps solid outline without inset shadow', () => {
    expect(seBlock).toContain('html[data-contrast="high"][data-ui-profile="super-engineering"]')
    expect(seBare).toContain('[data-slot="shell-search"]:focus-within')
    const hc = seBare.slice(seBare.indexOf('data-contrast="high"'))
    const body = hc.slice(hc.indexOf('{'), hc.indexOf('}') + 1)
    expect(body).toContain('box-shadow: none')
    expect(body).toMatch(/outline:\s*var\(--focus-ring-width/)
  })
})
