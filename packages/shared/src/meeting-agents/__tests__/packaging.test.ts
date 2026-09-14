import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_MEETING_AGENT_IDS, BUILTIN_MEETING_AGENTS } from '../catalog.ts'
import { MEETING_AGENT_PROMPTS } from '../prompts.ts'
import { MEETING_AGENT_TOOL_NAMES } from '../../agent/session-tool-defs.ts'
import { meetingCaptureCapability } from '../client-capabilities.ts'

const overlayUi = readFileSync(join(import.meta.dir, '../../../../../apps/electron/src/renderer/voice-overlay.tsx'), 'utf8')
const overlayHost = readFileSync(join(import.meta.dir, '../../../../../apps/electron/src/main/voice-overlay.ts'), 'utf8')
const catalogPath = join(import.meta.dir, '../../../../../apps/electron/resources/meeting-agents/catalog.json')
const copyScript = readFileSync(join(import.meta.dir, '../../../../../scripts/electron-build-resources.ts'), 'utf8')

describe('meeting packaging and a11y (issue 387 / I031)', () => {
  test('ships eight roles, prompts, skills, and schemas', () => {
    expect(BUILTIN_MEETING_AGENT_IDS).toHaveLength(8)
    expect(BUILTIN_MEETING_AGENTS).toHaveLength(8)
    for (const role of BUILTIN_MEETING_AGENTS) {
      expect(MEETING_AGENT_PROMPTS[role.id]?.prompt.length).toBeGreaterThan(0)
      expect(role.outputSchemaId).toMatch(/^meeting\./)
      for (const skill of role.skillIds) {
        expect(MEETING_AGENT_TOOL_NAMES.has(skill)).toBe(true)
      }
    }
    expect(existsSync(catalogPath)).toBe(true)
    const packaged = JSON.parse(readFileSync(catalogPath, 'utf8')) as { ids: string[] }
    expect(packaged.ids).toEqual([...BUILTIN_MEETING_AGENT_IDS])
    expect(copyScript).toContain('apps/electron')
    expect(copyScript).toContain('dist/resources')
  })

  test('overlay stays keyboard-reachable, reduced-motion safe, and non-focus-stealing', () => {
    expect(overlayUi).toContain('prefers-reduced-motion')
    expect(overlayUi).toContain('aria-live')
    expect(overlayUi).toContain('aria-label')
    expect(overlayUi).toContain('data-testid="meeting-ask"')
    expect(overlayHost).toContain('focusable: false')
    expect(overlayHost).toContain('showInactive')
  })

  test('web capture is honestly unsupported', () => {
    expect(meetingCaptureCapability({ isWebui: true }).supported).toBe(false)
    expect(meetingCaptureCapability({ isWebui: true }).code).toBe('web-unsupported')
    expect(meetingCaptureCapability({ hasDeviceIpc: false }).supported).toBe(false)
    expect(meetingCaptureCapability({ hasDeviceIpc: true }).supported).toBe(true)
  })
})
