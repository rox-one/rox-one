import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('P7.2 shell CSS motion tokens', () => {
  it('mode-pill item/indicator use --motion-* tokens, not hardcoded ms', () => {
    const css = readFileSync(join(import.meta.dir, '../../components/app-shell/titlebar-mode-pill.css'), 'utf8')
    expect(css.includes('160ms ease')).toBe(false)
    expect(css.includes('220ms cubic-bezier')).toBe(false)
    expect(css.includes('120ms ease')).toBe(false)
    expect(css).toContain('var(--motion-fast)')
    expect(css).toContain('var(--motion-disclosure)')
  })

  it('TopBarButton and avatar use --motion-fast', () => {
    const top = readFileSync(join(import.meta.dir, '../../components/ui/TopBarButton.tsx'), 'utf8')
    const av = readFileSync(join(import.meta.dir, '../../components/ui/avatar.tsx'), 'utf8')
    expect(top.includes('duration-100')).toBe(false)
    expect(top).toContain('duration-[var(--motion-fast)]')
    expect(av.includes('duration-200')).toBe(false)
    expect(av).toContain('duration-[var(--motion-fast)]')
  })
})
