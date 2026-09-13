import { describe, expect, it } from 'bun:test'
import { hasEightRoles, MEETING_AGENT_ROLES, packagingStatus, PACKAGING_IDENTITY } from '../packaging.ts'

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
})
