import { describe, expect, it } from 'bun:test'
import { countSessionFiles, resolveInspectorLayout, type InspectorLayoutInput } from '../inspector-layout'

const base: InspectorLayoutInput = {
  visible: true,
  userOpened: false,
  sessionMode: true,
  activeSection: 'files',
  fileCount: 3,
  terminalOpen: false,
  availableWidth: 800,
  storedWidth: 420,
  minWidth: 280,
  maxWidth: 1400,
  viewportCap: 1000,
}

describe('one-surface inspector layout', () => {
  it('shows the panel at its stored width when there is room', () => {
    expect(resolveInspectorLayout(base)).toEqual({ panelShown: true, collapsedReason: null, overlay: false, width: 420 })
  })

  it('collapses an empty session Files panel by default', () => {
    const layout = resolveInspectorLayout({ ...base, fileCount: 0 })
    expect(layout.panelShown).toBe(false)
    expect(layout.collapsedReason).toBe('empty-files')
  })

  it('keeps an empty Files panel open after an explicit toggle', () => {
    expect(resolveInspectorLayout({ ...base, fileCount: 0, userOpened: true }).panelShown).toBe(true)
  })

  it('does not auto-collapse other sections or unknown file counts', () => {
    expect(resolveInspectorLayout({ ...base, fileCount: 0, activeSection: 'git' }).panelShown).toBe(true)
    expect(resolveInspectorLayout({ ...base, fileCount: null }).panelShown).toBe(true)
    expect(resolveInspectorLayout({ ...base, fileCount: 0, terminalOpen: true }).panelShown).toBe(true)
  })

  it('narrows the panel so the center keeps its minimum', () => {
    expect(resolveInspectorLayout({ ...base, storedWidth: 600, availableWidth: 350 }).width).toBe(350)
  })

  it('collapses the panel before squeezing the center below its minimum', () => {
    const layout = resolveInspectorLayout({ ...base, availableWidth: 120 })
    expect(layout.panelShown).toBe(false)
    expect(layout.collapsedReason).toBe('squeezed')
  })

  it('an explicit open without room overlays the content instead of squeezing it', () => {
    expect(resolveInspectorLayout({ ...base, availableWidth: 120, userOpened: true })).toEqual({
      panelShown: true,
      collapsedReason: null,
      overlay: true,
      width: 420,
    })
  })

  it('respects persisted hidden state', () => {
    expect(resolveInspectorLayout({ ...base, visible: false }).panelShown).toBe(false)
    expect(resolveInspectorLayout({ ...base, visible: false }).collapsedReason).toBeNull()
  })

  it('counts files through nested directories', () => {
    expect(countSessionFiles([
      { type: 'file' },
      { type: 'directory', children: [{ type: 'file' }, { type: 'directory', children: [] }] },
    ])).toBe(2)
    expect(countSessionFiles([])).toBe(0)
    expect(countSessionFiles(null)).toBe(0)
  })
})
