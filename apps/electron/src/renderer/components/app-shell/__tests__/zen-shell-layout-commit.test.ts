import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../../../lib/shell-layout-preferences'

const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')

describe('AppShell layout commit boundary (ZS-06)', () => {
  it('loads and commits through the shell-layout adapter, not on pointermove', () => {
    expect(appShell).toContain('loadShellLayout')
    expect(appShell).toContain('usePanelResize')
    expect(appShell).toContain('commitShellLayout({ workspaceId: workspaceIdForLayout, sidebarWidth: sizeA })')
    expect(appShell).toContain('commitShellLayout({ workspaceId: workspaceIdForLayout, navigatorWidth: sizeA })')
    expect(appShell).toContain('onPreview: (sizeA) => setSidebarWidth(sizeA)')
    expect(appShell).toContain('onPreview: (sizeA) => setSessionListWidth(sizeA)')
    expect(appShell).not.toContain('const handleMouseMove')
    const previewSidebar = appShell.slice(
      appShell.indexOf('const sidebarResize = usePanelResize'),
      appShell.indexOf('const navigatorResize = usePanelResize'),
    )
    expect(previewSidebar).not.toContain('storage.set')
    expect(previewSidebar).toContain('onPreview: (sizeA) => setSidebarWidth(sizeA)')
    expect(previewSidebar).toContain('onCommit: (sizeA) => {')
    expect(previewSidebar).toContain('commitShellLayout({ workspaceId: workspaceIdForLayout, sidebarWidth: sizeA })')
  })

  it('allows sidebar preferred width up to 360 on the live path', () => {
    expect(SIDEBAR_WIDTH_MIN).toBe(180)
    expect(SIDEBAR_WIDTH_MAX).toBe(360)
    expect(appShell).toContain('maxA: SIDEBAR_WIDTH_MAX')
    expect(appShell).toContain('valueMax={SIDEBAR_WIDTH_MAX}')
  })
})
