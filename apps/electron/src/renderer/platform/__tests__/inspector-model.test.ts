import { describe, expect, it } from 'bun:test'
import {
  INSPECTOR_SECTION_IDS,
  SESSION_INSPECTOR_SECTION_IDS,
  inspectorSectionsForMode,
  isSessionInspectorSection,
  normalizeInspectorSection,
  resolveInspectorToggle,
} from '../inspector-model'

describe('inspector-model session harness', () => {
  it('lists files/git/browser/context only in session mode', () => {
    expect(inspectorSectionsForMode('session')).toEqual(SESSION_INSPECTOR_SECTION_IDS)
    expect(inspectorSectionsForMode('knowledge')).not.toContain('files')
    expect(SESSION_INSPECTOR_SECTION_IDS).toEqual(['files', 'git', 'browser', 'context'])
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
})
