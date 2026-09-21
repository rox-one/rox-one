import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShell = join(import.meta.dir, '..')
const browser = join(import.meta.dir, '../../browser/WebBrowserPanel.tsx')
const stack = readFileSync(join(appShell, 'PanelStackContainer.tsx'), 'utf8')
const lane = readFileSync(join(appShell, 'HeaderStatusLane.tsx'), 'utf8')
const input = readFileSync(join(appShell, 'input/FreeFormInput.tsx'), 'utf8')
const browserSrc = readFileSync(browser, 'utf8')
const inspector = readFileSync(join(appShell, '../../platform/InspectorHost.tsx'), 'utf8')
const host = readFileSync(join(appShell, '../../platform/WorkspaceSurfaceHost.tsx'), 'utf8')

describe('ship-rox-chrome-leftover-post-960', () => {
  it('equalizes compact panel bottom inset without magic ±6', () => {
    const compact = stack.slice(0, stack.indexOf('DESKTOP BRANCH'))
    expect(compact).toContain('paddingBottom: PANEL_STACK_BOTTOM_INSET')
    expect(compact).not.toContain('marginBottom: -6')
    expect(compact).not.toContain('paddingBottom: 6,')
  })

  it('makes chat status lane and browser chrome opaque without blur', () => {
    expect(lane).toContain('bg-background')
    expect(lane).not.toContain('bg-background/95')
    expect(browserSrc).toContain('bg-background px-2')
    expect(browserSrc).not.toContain('backdrop-blur')
    expect(browserSrc).not.toContain('bg-background/95')
  })

  it('aligns FreeFormInput toolbar leftovers to 9px / h-6', () => {
    expect(input).toContain('data-testid="chat-session-cost"')
    expect(input).toMatch(/chat-session-cost[\s\S]{0,80}text-\[9px\]|text-\[9px\][\s\S]{0,80}chat-session-cost/)
    const toolbar = input.split('\n').filter((l) => l.includes('input-toolbar-btn'))
    expect(toolbar.some((l) => l.includes('h-6') && l.includes('text-[9px]'))).toBe(true)
    expect(toolbar.every((l) => !l.includes('text-[11px]') && !l.includes('h-7'))).toBe(true)
  })

  it('does not reopen inspector strip host from #958/#959', () => {
    expect(host).toContain('(chrome.showInspector || inspectorVisible || chromeCollapsed) && <InspectorHost />')
    const start = inspector.indexOf('if (chromeCollapsed)')
    const collapsedReturn = inspector.indexOf('return (', start)
    const expandedReturn = inspector.indexOf('return (', collapsedReturn + 1)
    const collapsed = inspector.slice(start, expandedReturn)
    expect(collapsed).toContain('w-[28px]')
    expect(collapsed).toContain('h-full')
    expect(collapsed).not.toContain('mt-1 mb-1')
  })
})
