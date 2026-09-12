import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellPath = join(__dirname, '../AppShell.tsx')
const profileStripPath = join(__dirname, '../ProfileStrip.tsx')
const topBarPath = join(__dirname, '../TopBar.tsx')

describe('TopBar navigation cutover', () => {
  const appShellSource = readFileSync(appShellPath, 'utf8')
  const profileStripSource = readFileSync(profileStripPath, 'utf8')
  const source = readFileSync(topBarPath, 'utf8')

  it('leaves keyboard shortcut discovery to Settings instead of rendering a duplicate button', () => {
    expect(source).not.toContain('onOpenKeyboardShortcuts')
    expect(source).not.toContain('menu.keyboardShortcuts')
  })

  it('forwards Settings subpage navigation to the canonical AppMenu route', () => {
    expect(source).toContain('onOpenSettingsSubpage={onOpenSettingsSubpage}')
  })

  it('keeps the compact left sidebar control wired to its existing callback', () => {
    expect(source).toContain('<TopBarButton onClick={onToggleSidebar}')
    expect(source).toContain('<PanelLeftRounded')
    expect(source).toContain('aria-label={t("menu.toggleSidebar")}')
  })

  it('toggles the right inspector and restores fully collapsed chrome', () => {
    expect(source).toContain('useAtom(inspectorVisibleAtom)')
    expect(source).toContain('useAtom(inspectorChromeCollapsedAtom)')
    expect(source).toContain('if (!inspectorOpen)')
    expect(source).toContain('setInspectorChromeCollapsed(false)')
    expect(source).toContain('setInspectorVisible(true)')
    expect(source).toContain('setInspectorChromeCollapsed(true)')
    expect(source).toContain('setInspectorVisible(false)')
    expect(source).toContain("t(inspectorOpen ? 'inspector.hide' : 'inspector.expand')")
    expect(source).toContain('aria-pressed={inspectorOpen}')
    expect(source).toContain('{showInspectorToggle && <Tooltip>')
  })

  it('exposes a dedicated Map affordance for the focused session', () => {
    expect(source).toContain('onClick={onOpenMap}')
    expect(source).toContain('disabled={!mapAvailable}')
    expect(source).toContain('aria-label={t("entityView.map")}')
    expect(appShellSource).toContain("new CustomEvent('craft:session-view'")
    expect(appShellSource).toContain("detail: { sessionId: effectiveSessionId, view: 'map' }")
  })

  it('does not retain the legacy TopBar What’s New action', () => {
    expect(source).not.toContain('onWhatsNew')
    expect(source).not.toContain('hasUnseenWhatsNew')
    expect(appShellSource).not.toContain('onWhatsNew={')
    expect(appShellSource).not.toContain('hasUnseenWhatsNew={')
  })

  it('does not keep update checks on the ProfileStrip', () => {
    expect(profileStripSource).not.toContain("t('menu.checkForUpdates')")
    expect(profileStripSource).not.toContain('window.electronAPI.checkForUpdates()')
  })
})
