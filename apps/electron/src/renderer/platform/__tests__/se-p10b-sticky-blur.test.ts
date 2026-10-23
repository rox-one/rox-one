import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')

describe('P10b sticky chrome — Cookbooks + KnowledgeHome solid SE surfaces', () => {
  it('CookbooksSurfacePage document header uses solid bg-background (no backdrop-blur)', () => {
    const src = readFileSync(join(root, 'pages/cookbooks/CookbooksSurfacePage.tsx'), 'utf8')
    const header = src.match(/<header data-glass-slot="toolbar" className="([^"]+)"/)
    expect(header).not.toBeNull()
    const cls = header![1]
    expect(cls.includes('sticky top-0')).toBe(true)
    expect(cls.includes('bg-background')).toBe(true)
    expect(cls.includes('bg-background/')).toBe(false)
    expect(cls.includes('backdrop-blur')).toBe(false)
  })

  it('KnowledgeHome view group stickies drop backdrop-blur', () => {
    const src = readFileSync(join(root, 'knowledge/KnowledgeHome.tsx'), 'utf8')
    expect(src.includes('backdrop-blur')).toBe(false)
    expect(src.includes('bg-background/95')).toBe(false)
    expect(src).toContain('sticky top-0 z-[1] bg-background ')
  })
})
