import { describe, expect, it } from 'bun:test'
import { resolveWorkbenchChrome, shouldShowStatusBar } from '../workbench-chrome'

const OFF = {
  unifiedShell: false,
  modeRegistry: false,
  topChrome: false,
  tabGroups: false,
  browserSurface: false,
  statusBar: false,
}

describe('resolveWorkbenchChrome', () => {
  it('hides all v2 chrome when every flag is off', () => {
    expect(resolveWorkbenchChrome(OFF)).toEqual({
      showRail: false,
      showSurfaceTabs: false,
      showInspector: false,
      showModeBar: false,
      hideBrowserTabStrip: false,
      showStatusBar: false,
      utilityRail: false,
    })
  })

  it('keeps W1 rail, tabs and inspector together', () => {
    const chrome = resolveWorkbenchChrome({ ...OFF, unifiedShell: true })
    expect(chrome.showRail).toBe(true)
    expect(chrome.showSurfaceTabs).toBe(true)
    expect(chrome.showInspector).toBe(true)
    expect(chrome.showModeBar).toBe(false)
    expect(chrome.utilityRail).toBe(false)
  })

  it('shows Mode Bar when either mode-registry or top-chrome is on', () => {
    expect(resolveWorkbenchChrome({ ...OFF, modeRegistry: true }).showModeBar).toBe(true)
    expect(resolveWorkbenchChrome({ ...OFF, topChrome: true }).showModeBar).toBe(true)
  })

  it('turns the rail into utilities under top-chrome even without W1', () => {
    const chrome = resolveWorkbenchChrome({ ...OFF, topChrome: true })
    expect(chrome.showRail).toBe(true)
    expect(chrome.utilityRail).toBe(true)
    expect(chrome.showInspector).toBe(false)
  })

  it('shows surface tabs for tab-groups or browser-surface without inspector', () => {
    expect(resolveWorkbenchChrome({ ...OFF, tabGroups: true }).showSurfaceTabs).toBe(true)
    expect(resolveWorkbenchChrome({ ...OFF, browserSurface: true })).toMatchObject({
      showSurfaceTabs: true,
      hideBrowserTabStrip: true,
      showInspector: false,
    })
  })

  it('hides the status bar in compact layout even when the flag is on', () => {
    expect(resolveWorkbenchChrome({ ...OFF, statusBar: true }).showStatusBar).toBe(true)
    expect(shouldShowStatusBar(true, false)).toBe(true)
    expect(shouldShowStatusBar(true, true)).toBe(false)
    expect(shouldShowStatusBar(false, false)).toBe(false)
  })
})
