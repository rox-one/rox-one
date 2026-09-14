import { describe, expect, it } from 'bun:test'
import {
  INSPECTOR_SECTION_IDS,
  INSPECTOR_DEFAULT_WIDTH,
  KNOWLEDGE_INSPECTOR_SECTION_IDS,
  SESSION_INSPECTOR_SECTION_IDS,
  inspectorSectionsForMode,
  inspectorResizeBounds,
  inspectorResizeWidthForKey,
  inspectorWidthLimits,
  isInspectorPanelVisible,
  isSessionInspectorSection,
  normalizeInspectorSection,
  normalizeInspectorWidth,
  resolveInspectorDefaults,
  resolveBottomTerminalToggle,
  resolveInspectorToggle,
} from '../inspector-model'
import { createResizeController } from '../../components/app-shell/resize-controller'

describe('inspector-model session harness', () => {
  it('exposes one browser section in both inspector modes while keeping session-only sections scoped', () => {
    expect(inspectorSectionsForMode('session')).toEqual(SESSION_INSPECTOR_SECTION_IDS)
    expect(inspectorSectionsForMode('knowledge')).not.toContain('files')
    expect(KNOWLEDGE_INSPECTOR_SECTION_IDS).toContain('browser')
    expect(SESSION_INSPECTOR_SECTION_IDS).toEqual(['files', 'git', 'browser', 'context'])
    expect(SESSION_INSPECTOR_SECTION_IDS.filter((section) => section === 'browser')).toHaveLength(1)
    expect(INSPECTOR_SECTION_IDS).not.toContain('terminal')
  })

  it('normalizes unknown persisted sections to info', () => {
    expect(normalizeInspectorSection('files')).toBe('files')
    expect(normalizeInspectorSection('terminal')).toBe('info')
    expect(normalizeInspectorSection(undefined)).toBe('info')
  })

  it('toggles hide on a second click of the same section', () => {
    const opened = resolveInspectorToggle({ visible: false, section: 'info' }, 'git')
    expect(opened).toEqual({ visible: true, section: 'git' })
    expect(resolveInspectorToggle(opened, 'git')).toEqual({ visible: false, section: 'git' })
  })

  it('marks session sections', () => {
    expect(isSessionInspectorSection('git')).toBe(true)
    expect(isSessionInspectorSection('info')).toBe(false)
  })

  it('toggles the bottom terminal directly and closes the side alternate', () => {
    const opened = resolveBottomTerminalToggle({ bottomOpen: false, sideOpen: true })
    expect(opened).toEqual({ bottomOpen: true, sideOpen: false })
    expect(resolveBottomTerminalToggle(opened)).toEqual({ bottomOpen: false, sideOpen: false })
  })
})

describe('quiet inspector preferences and actual content', () => {
  it('starts fresh installations with no inspector chrome or empty panel', () => {
    expect(resolveInspectorDefaults({})).toEqual({ visible: false, chromeCollapsed: true })
    expect(resolveInspectorDefaults({ visible: 'true', chromeCollapsed: 1 })).toEqual({ visible: false, chromeCollapsed: true })
  })

  it('preserves every explicitly saved legacy boolean, including rail-only preference', () => {
    expect(resolveInspectorDefaults({ visible: true })).toEqual({ visible: true, chromeCollapsed: false })
    expect(resolveInspectorDefaults({ visible: false })).toEqual({ visible: false, chromeCollapsed: false })
    expect(resolveInspectorDefaults({ chromeCollapsed: false })).toEqual({ visible: true, chromeCollapsed: false })
    expect(resolveInspectorDefaults({ chromeCollapsed: true })).toEqual({ visible: false, chromeCollapsed: true })
    for (const visible of [false, true]) for (const chromeCollapsed of [false, true]) {
      expect(resolveInspectorDefaults({ visible, chromeCollapsed })).toEqual({ visible, chromeCollapsed })
    }
  })

  it('suppresses files, git and context until their session exists without rewriting preferences', () => {
    for (const section of ['files', 'git', 'context'] as const) {
      const saved = Object.freeze({ visible: true, chromeCollapsed: false, section })
      expect(isInspectorPanelVisible({ ...saved, hasSession: false })).toBe(false)
      expect(isInspectorPanelVisible({ ...saved, hasSession: true })).toBe(true)
      expect(saved.visible).toBe(true)
      expect(saved.section).toBe(section)
    }
  })

  it('opens global browser and explicit terminal even on an empty catalog', () => {
    expect(isInspectorPanelVisible({ visible: true, chromeCollapsed: false, section: 'browser', hasSession: false })).toBe(true)
    expect(isInspectorPanelVisible({ visible: true, chromeCollapsed: false, section: 'files', hasSession: false, terminalOpen: true })).toBe(true)
  })

  it('never reserves a panel for hidden chrome, including native browser content', () => {
    for (const section of INSPECTOR_SECTION_IDS) {
      expect(isInspectorPanelVisible({ visible: true, chromeCollapsed: true, section, hasSession: true })).toBe(false)
      expect(isInspectorPanelVisible({ visible: false, chromeCollapsed: false, section, hasSession: true })).toBe(false)
    }
  })
})

describe('bounded inspector resize', () => {
  it('normalizes malformed stored widths and retains valid committed preferences', () => {
    for (const value of [undefined, '420', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeInspectorWidth(value, 1440)).toBe(INSPECTOR_DEFAULT_WIDTH)
    }
    expect(normalizeInspectorWidth(420, 1440)).toBe(420)
    expect(normalizeInspectorWidth(-10, 1440)).toBe(280)
    expect(normalizeInspectorWidth(100000, 1440)).toBe(864)
  })

  it('keeps width limits feasible after narrowing, without changing saved width', () => {
    for (const viewport of [320, 640, 1024, 1440, 4000]) {
      const limits = inspectorWidthLimits(viewport)
      const rendered = normalizeInspectorWidth(560, viewport)
      expect(limits.min).toBeLessThanOrEqual(limits.max)
      expect(rendered).toBeLessThanOrEqual(viewport * 0.6)
      expect(rendered).toBeGreaterThanOrEqual(limits.min)
    }
    expect(normalizeInspectorWidth(560, 640)).toBe(384)
    expect(normalizeInspectorWidth(560, 1440)).toBe(560)
  })

  it('follows physical arrow directions and provides min/max keyboard actions', () => {
    expect(inspectorResizeWidthForKey('ArrowLeft', false, 336, 1440)).toBe(344)
    expect(inspectorResizeWidthForKey('ArrowRight', true, 336, 1440)).toBe(304)
    expect(inspectorResizeWidthForKey('ArrowRight', true, 280, 1440)).toBe(280)
    expect(inspectorResizeWidthForKey('Home', false, 336, 1440)).toBe(280)
    expect(inspectorResizeWidthForKey('End', false, 336, 1440)).toBe(864)
    expect(inspectorResizeWidthForKey('Tab', false, 336, 1440)).toBeNull()
  })

  it('previews a drag once per frame, commits once, and never writes during preview', () => {
    const frames: Array<() => void> = []
    const previews: number[] = []
    const commits: number[] = []
    const controller = createResizeController({
      onPreview: (_left, right) => previews.push(right),
      onCommit: (_left, right) => commits.push(right),
      onCancel: () => {},
      requestFrame: (callback) => { frames.push(callback); return frames.length },
      cancelFrame: () => { frames.length = 0 },
    })
    expect(controller.start(inspectorResizeBounds(336, 1440))).toBe(true)
    previews.length = 0
    for (let index = 0; index < 1000; index++) controller.moveBy(-8)
    expect(frames).toHaveLength(1)
    expect(commits).toHaveLength(0)
    frames[0]!()
    expect(previews).toEqual([864])
    controller.commit()
    controller.commit()
    expect(commits).toEqual([864])
  })

  it('cancellation and disposal restore the committed width without persisting the preview', () => {
    for (const finish of ['cancel', 'dispose'] as const) {
      let width = 420
      const commits: number[] = []
      const controller = createResizeController({
        onPreview: (_left, right) => { width = right },
        onCommit: (_left, right) => commits.push(right),
        onCancel: (_left, right) => { width = right },
      })
      controller.start(inspectorResizeBounds(width, 1440))
      controller.moveBy(-120, true)
      expect(width).toBe(540)
      controller[finish]()
      controller[finish]()
      expect(width).toBe(420)
      expect(commits).toEqual([])
      expect(controller.active).toBe(false)
    }
  })
})
