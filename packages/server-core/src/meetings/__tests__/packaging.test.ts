import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_MEETING_AGENT_IDS } from '@craft-agent/shared/meeting-agents'
import {
  hasEightRoles,
  MEETING_AGENT_ROLES,
  PACKAGING_IDENTITY,
  packagingStatus,
  refuseCodesign,
  stageMeetingAgentResources,
} from '../packaging.ts'

describe('meeting-agent packaging (#387)', () => {
  it('asserts eight role definitions', () => {
    expect(MEETING_AGENT_ROLES).toHaveLength(8)
    expect(hasEightRoles([...MEETING_AGENT_ROLES])).toBe(true)
  })

  it('does not rename protocol/storage/OAuth/package ids', () => {
    expect(PACKAGING_IDENTITY.protocol).toBe('rox-agent')
    expect(PACKAGING_IDENTITY.storage).toBe('craft-agent')
  })

  it('unverified OS packaging is blocked, not passed', () => {
    expect(packagingStatus('linux', false)).toBe('blocked')
    expect(packagingStatus('darwin', false)).toBe('blocked')
    expect(packagingStatus('win32', false)).toBe('blocked')
  })

  it('stages eight builtin agents on linux without codesign', () => {
    const dest = mkdtempSync(join(tmpdir(), 'meeting-agents-'))
    const staged = stageMeetingAgentResources(dest, { os: 'linux', codesign: false })
    expect(staged.signed).toBe(false)
    expect(staged.resourceStage).toBe('passed')
    expect(staged.osPackage).toBe('blocked')
    expect(staged.roles).toEqual([...BUILTIN_MEETING_AGENT_IDS])
    expect(readdirSync(dest)).toHaveLength(8)
    const first = JSON.parse(readFileSync(join(dest, `${staged.roles[0]}.json`), 'utf8')) as { storage: string; signed: boolean }
    expect(first.storage).toBe('craft-agent')
    expect(first.signed).toBe(false)
    expect(() => refuseCodesign(true)).toThrow('codesign-not-supported')
  })
})
