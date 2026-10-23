import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../../components/ui/TopBarButton.tsx'), 'utf8')

describe('P9.2 TopBarButton calm chrome', () => {
  it('keeps header-icon-btn for SE focus (#2211)', () => {
    expect(src).toContain('header-icon-btn')
    expect(src).toContain('duration-[var(--motion-fast)]')
  })

  it('deletes double plate + glass blur + second focus ring', () => {
    expect(src.includes('border-border-subtle')).toBe(false)
    expect(src.includes('inset_0_0_0_1px')).toBe(false)
    expect(src.includes('backdrop-filter')).toBe(false)
    expect(src.includes('chrome-glass-blur')).toBe(false)
    expect(src.includes('focus-visible:ring-2')).toBe(false)
    expect(src.includes('focus-visible:ring-ring')).toBe(false)
  })
})
