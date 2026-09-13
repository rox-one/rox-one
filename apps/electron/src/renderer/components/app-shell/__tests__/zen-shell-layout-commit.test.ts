import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')

describe('AppShell layout commit boundary (ZS-06)', () => {
  it('loads and commits through the shell-layout adapter, not on pointermove', () => {
    expect(appShell).toContain('loadShellLayout')
    expect(appShell).toContain('commitShellLayout')
    expect(appShell).toContain('commitShellLayout({ workspaceId, sidebarWidth })')
    expect(appShell).toContain('commitShellLayout({ workspaceId, navigatorWidth: sessionListWidth })')
    const moveBlock = appShell.slice(appShell.indexOf('const handleMouseMove'), appShell.indexOf('const handleMouseUp'))
    expect(moveBlock).not.toContain('storage.set')
    expect(moveBlock).not.toContain('commitShellLayout')
  })

  it('allows sidebar preferred width up to 360 on the live path', () => {
    expect(appShell).toContain('Math.min(Math.max(e.clientX, 180), 360)')
  })
})
