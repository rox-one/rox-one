import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const inspectorPath = join(import.meta.dir, '..', 'InspectorBrowserPane.tsx')
const pagePath = join(import.meta.dir, '..', '..', '..', 'pages', 'BrowserPanelPage.tsx')
const interceptorPath = join(import.meta.dir, '..', '..', '..', 'hooks', 'useLinkInterceptor.ts')
const appPath = join(import.meta.dir, '..', '..', '..', 'App.tsx')
const mainPanelPath = join(import.meta.dir, '..', '..', 'app-shell', 'MainContentPanel.tsx')

describe('Issue 14 pane lifecycle and link routing', () => {
  const inspector = readFileSync(inspectorPath, 'utf8')
  const page = readFileSync(pagePath, 'utf8')
  const interceptor = readFileSync(interceptorPath, 'utf8')
  const app = readFileSync(appPath, 'utf8')
  const mainPanel = readFileSync(mainPanelPath, 'utf8')

  it('reuses the retained embedded pane and does not destroy siblings on mount', () => {
    expect(inspector).toContain('planRetainedBrowserOpen')
    expect(inspector).toContain('window.electronAPI.browserPane.createEmbedded')
    expect(inspector).toContain('<BrowserPanelPage instanceId={instanceId} persist />')
    expect(inspector).not.toContain('.filter((item) => item.embedded)')
    expect(inspector).not.toContain('browserPane.destroy')
  })

  it('hides on unmount and restores instead of leaving a dead pane', () => {
    expect(page).toContain('persist = true')
    expect(page).toContain("t('browser.restore')")
    expect(page).toContain("t('browser.closed')")
    expect(mainPanel).toContain('<BrowserPanelPage instanceId={instanceId} panelId={panelId} persist />')
  })

  it('routes safe https links into the retained browser from chat', () => {
    expect(interceptor).toContain('classifyLinkPolicy')
    expect(interceptor).toContain("policy.kind === 'internal-browser'")
    expect(app).toContain('queueInternalBrowserUrl')
    expect(app).toContain("new CustomEvent('craft:open-vps-browser')")
  })
})
