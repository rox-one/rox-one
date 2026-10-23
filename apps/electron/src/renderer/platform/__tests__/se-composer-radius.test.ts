import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const radius = readFileSync(join(root, 'packages/ui/src/styles/tokens/radius.css'), 'utf8')
const inputContainer = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx'),
  'utf8',
)
const freeForm = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx'),
  'utf8',
)
const preset = JSON.parse(
  readFileSync(join(root, 'apps/electron/resources/themes/super-engineering.json'), 'utf8'),
)

/** First SE profile :root-like vars block (html[data-ui-profile=...] { ... }). */
function firstSeProfileVars(css: string): string {
  const marker = 'html[data-ui-profile="super-engineering"] {'
  const start = css.indexOf(marker)
  if (start < 0) return ''
  let i = start + marker.length
  let depth = 1
  while (i < css.length && depth > 0) {
    const ch = css[i++]
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  return css.slice(start, i)
}

const seProfile = firstSeProfileVars(ui)

describe('SE shared composer radius (canon 10px)', () => {
  it('preset stays Rox Engineering / super-engineering', () => {
    expect(preset.name).toBe('Rox Engineering')
    expect(preset.uiProfile).toBe('super-engineering')
  })

  it('root default composer role stays on the scale (8px via --radius-md)', () => {
    expect(radius).toMatch(/--radius-composer:\s*var\(--radius-md\)/)
    expect(radius).toMatch(/--radius-md:\s*8px/)
  })

  it('SE profile sets --radius-composer to 10px and aliases --rox-radius-composer', () => {
    expect(seProfile.length).toBeGreaterThan(0)
    expect(seProfile).toMatch(/--radius-composer:\s*10px/)
    expect(seProfile).toMatch(/--rox-radius-composer:\s*var\(--radius-composer\)/)
    // Must not keep the prior 12px (--radius-lg) SE alias.
    expect(seProfile).not.toMatch(/--rox-radius-composer:\s*var\(--radius-lg\)/)
  })

  it('SE .input-container chrome uses the composer token (shared shell only)', () => {
    const rule = ui.match(
      /html\[data-ui-profile="super-engineering"\] \.input-container\s*\{([^}]*)\}/,
    )![1]!
    expect(rule).toContain('border-radius: var(--radius-composer)')
  })

  it('shared InputContainer and FreeFormInput read --radius-composer', () => {
    expect(inputContainer).toContain('rounded-[var(--radius-composer)]')
    expect(freeForm).toContain('rounded-[var(--radius-composer)]')
  })
})
