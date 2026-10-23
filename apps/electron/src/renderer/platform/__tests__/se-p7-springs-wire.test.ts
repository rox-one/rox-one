import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('P7.1 SE springs wire', () => {
  it('CompactPanelTransition and MobileAppMenu use SE_SPRING_PANEL, not one-off SNAPPY', () => {
    const compact = readFileSync(join(import.meta.dir, '../../components/app-shell/CompactPanelTransition.tsx'), 'utf8')
    const menu = readFileSync(join(import.meta.dir, '../../components/app-menu/MobileAppMenu.tsx'), 'utf8')
    for (const [name, src] of [['CompactPanelTransition', compact], ['MobileAppMenu', menu]] as const) {
      expect(src.includes('SNAPPY_SPRING'), `${name} still has SNAPPY_SPRING`).toBe(false)
      expect(src).toContain('SE_SPRING_PANEL')
    }
  })
})
