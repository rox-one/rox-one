import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Zen Shell chrome/content roles (ZS-02)', () => {
  it('marks top bar and sidebar as chrome and panels as opaque content', () => {
    const topBar = readFileSync(join(import.meta.dir, '../TopBar.tsx'), 'utf8')
    const panelSlot = readFileSync(join(import.meta.dir, '../PanelSlot.tsx'), 'utf8')
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    expect(topBar).toContain('data-shell-role="chrome"')
    expect(panelSlot).toContain('data-shell-role="content"')
    expect(appShell).toContain('data-shell-role="chrome"')
    expect(appShell).toContain('chrome-rail')
  })
})
