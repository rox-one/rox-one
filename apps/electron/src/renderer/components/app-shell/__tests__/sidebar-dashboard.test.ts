import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShell = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const topBar = readFileSync(join(__dirname, '../TopBar.tsx'), 'utf8')
const sidebarChrome = readFileSync(join(__dirname, '../SidebarChrome.tsx'), 'utf8')
const miniCards = readFileSync(join(__dirname, '../MiniDashboardCards.tsx'), 'utf8')

describe('sidebar dashboard source contracts', () => {
  it('localizes the scheduled-automation machine warning', () => {
    expect(appShell).toContain('t("automations.schedulingRequiresMachine")')
    expect(appShell).not.toContain('Scheduling requires your machine to be running')
  })

  it('mounts usage cards on the account page, not the sidebar', () => {
    expect(appShell).toContain('<SidebarChrome')
    expect(sidebarChrome).not.toContain('<MiniDashboardCards')
    expect(sidebarChrome).toContain('<ProfileStrip')
    expect(miniCards).toContain('dashboard.unknown')
    expect(miniCards).toContain('snapshot.tokens == null')
  })

  it('keeps TopBar session/browser shortcuts as labeled icon buttons', () => {
    expect(topBar).toContain('session.newSessionInPanel')
    expect(topBar).toContain('browser.newWindow')
    expect(topBar).not.toContain('menu.addPanelMenu')
  })
})
