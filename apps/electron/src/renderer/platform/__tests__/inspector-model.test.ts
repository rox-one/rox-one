import { describe, expect, it } from 'bun:test'
import {
  INSPECTOR_SECTION_IDS,
  KNOWLEDGE_INSPECTOR_SECTION_IDS,
  SESSION_INSPECTOR_SECTION_IDS,
  inspectorSectionsForMode,
  isSessionInspectorSection,
  normalizeInspectorSection,
  resolveBottomTerminalToggle,
  resolveInspectorToggle,
} from '../inspector-model'

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
