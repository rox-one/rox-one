import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../../../../../')
const indexCss = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const modePill = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/titlebar-mode-pill.css'),
  'utf8',
)

/** Slice SE-scoped rules from index.css (same approach as se-shell-bg-fg). */
function seBare(src: string): string {
  const parts = src.split(/html\[data-ui-profile="super-engineering"\]/)
  return parts.slice(1).join('\n')
}

describe('P10.3 SE mode-pill kill residual saturate', () => {
  it('base plate still declares blur+saturate (non-SE profiles)', () => {
    expect(modePill).toContain('saturate(1.1)')
    expect(modePill).toContain('blur(var(--chrome-glass-blur))')
  })

  it('SE overrides mode-pill backdrop-filter to none', () => {
    const se = seBare(indexCss)
    expect(se).toMatch(/\.rox-mode-pill\s*\{[^}]*backdrop-filter:\s*none/)
    expect(se).toMatch(/\.rox-mode-pill\s*\{[^}]*-webkit-backdrop-filter:\s*none/)
  })
})
