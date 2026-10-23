import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const files = ['TaskDetail.tsx', 'TaskSidebar.tsx', 'parts.tsx']

describe('P6 Tasks chrome (SE surface fills)', () => {
  it('uses surface-hover/pressed, not foreground-alpha fills', () => {
    for (const name of files) {
      const src = readFileSync(join(import.meta.dir, '..', name), 'utf8')
      expect(src.includes('bg-foreground/['), `${name} still has bg-foreground/[`).toBe(false)
      expect(src.includes('hover:bg-foreground/['), `${name} still has hover fg`).toBe(false)
      expect(src.includes('focus:bg-foreground/['), `${name} still has focus fg`).toBe(false)
    }
    const detail = readFileSync(join(import.meta.dir, '../TaskDetail.tsx'), 'utf8')
    expect(detail).toContain('bg-surface-hover')
    expect(detail).toContain('focus:bg-surface-pressed')
  })
})
