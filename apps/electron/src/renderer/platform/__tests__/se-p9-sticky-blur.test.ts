import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')

describe('P9.1 sticky chrome — no Arc-Glass blur leftovers', () => {
  it('SessionSearchHeader uses solid bg-background (no backdrop-blur)', () => {
    const src = readFileSync(join(root, 'components/app-shell/SessionSearchHeader.tsx'), 'utf8')
    expect(src).toContain('bg-background')
    expect(src.includes('backdrop-blur')).toBe(false)
    expect(src.includes('bg-background/95')).toBe(false)
  })

  it('Session table sticky headers drop backdrop-blur', () => {
    const host = readFileSync(join(root, 'components/app-shell/session-table/SessionTableHost.tsx'), 'utf8')
    const group = readFileSync(join(root, 'components/app-shell/session-table/SessionTableGroupHeader.tsx'), 'utf8')
    for (const [name, src] of [['Host', host], ['Group', group]] as const) {
      expect(src.includes('backdrop-blur'), `${name} still has backdrop-blur`).toBe(false)
      expect(src.includes('bg-background/95'), `${name} still has /95 tint`).toBe(false)
    }
  })
})
