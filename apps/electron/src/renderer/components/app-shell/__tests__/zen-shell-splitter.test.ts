import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Zen Shell splitter wiring (ZS-05)', () => {
  it('uses ResizeHandle and pointer capture rather than document mousemove', () => {
    const sash = readFileSync(join(import.meta.dir, '../PanelResizeSash.tsx'), 'utf8')
    const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    expect(sash).toContain('usePanelResize')
    expect(sash).toContain('neighborChanged')
    expect(appShell).toContain('labelKey="shell.resize.sidebar"')
    expect(appShell).toContain('labelKey="shell.resize.navigator"')
    expect(appShell).not.toMatch(/document\.addEventListener\('mousemove', handleMouseMove\)/)
  })
})
