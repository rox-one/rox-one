import { describe, expect, it } from 'bun:test'
import {
  applyPackagedUpgrade,
  hasEightRoles,
  MEETING_AGENT_ROLES,
  PACKAGING_IDENTITY,
  PACKAGING_OS_SMOKE_EVIDENCE,
  PACKAGING_RESOURCE_EVIDENCE,
  packagedOsSmokeStatus,
  packagingStatus,
  startOsCapture,
  WEB_MEETING_SURFACE,
} from '../packaging.ts'

describe('meeting-agent packaging (#387)', () => {
  it('asserts eight role definitions', () => {
    expect(MEETING_AGENT_ROLES).toHaveLength(8)
    expect(hasEightRoles([...MEETING_AGENT_ROLES])).toBe(true)
  })

  it('does not rename protocol/storage/OAuth/package ids', () => {
    expect(PACKAGING_IDENTITY.protocol).toBe('rox-agent')
    expect(PACKAGING_IDENTITY.storage).toBe('craft-agent')
    expect(PACKAGING_IDENTITY.oauth).toBe('rox')
    expect(PACKAGING_IDENTITY.packageId).toBe('rox-one')
  })

  it('unverified OS packaging is blocked, not passed', () => {
    expect(packagingStatus('linux', false)).toBe('blocked')
    expect(packagingStatus('darwin', false)).toBe('blocked')
    expect(packagingStatus('win32', false)).toBe('blocked')
  })

  it('is linux-only: verified darwin/win32 cannot fake passed OS packaging', () => {
    expect(packagingStatus('darwin', true)).toBe('blocked')
    expect(packagingStatus('win32', true)).toBe('blocked')
  })

  it('does not let a verified linux flag fake packaged OS smoke as passed', () => {
    expect(packagingStatus('linux', true)).not.toBe('passed')
    expect(packagedOsSmokeStatus('linux')).toBe('not_run')
    expect(packagedOsSmokeStatus('darwin')).toBe('not_run')
    expect(packagedOsSmokeStatus('win32')).toBe('not_run')
    expect(PACKAGING_RESOURCE_EVIDENCE).toBe('U1')
    expect(PACKAGING_OS_SMOKE_EVIDENCE).toBe('N5')
  })

  it('upgrade and rollback keep user overrides, consent, and data', () => {
    const previous = {
      overrides: { model: 'user-pick', locale: 'ru' },
      consent: { recording: true, analytics: false },
      data: { notes: 'keep-me', tasks: 'open' },
    }
    const bundled = {
      overrides: { model: 'bundled-default', locale: 'en', theme: 'dark' },
      consent: { recording: false, analytics: true },
      data: { notes: 'factory', tasks: 'empty' },
    }
    const upgraded = applyPackagedUpgrade(previous, bundled)
    expect(upgraded.overrides).toEqual({ model: 'user-pick', locale: 'ru', theme: 'dark' })
    expect(upgraded.consent).toEqual({ recording: true, analytics: false })
    expect(upgraded.data).toEqual({ notes: 'keep-me', tasks: 'open' })

    const rolledBack = applyPackagedUpgrade(upgraded, {
      overrides: { model: 'old-default' },
      consent: { recording: false },
      data: { notes: 'old-factory' },
    })
    expect(rolledBack.overrides.model).toBe('user-pick')
    expect(rolledBack.consent.recording).toBe(true)
    expect(rolledBack.data.notes).toBe('keep-me')
  })

  it('web review/approve/notes/tasks cannot fake OS capture', () => {
    expect(WEB_MEETING_SURFACE.review).toBe(true)
    expect(WEB_MEETING_SURFACE.approve).toBe(true)
    expect(WEB_MEETING_SURFACE.notes).toBe(true)
    expect(WEB_MEETING_SURFACE.tasks).toBe(true)
    expect(WEB_MEETING_SURFACE.osCapture).toBe(false)

    const web = startOsCapture('web')
    expect(web.status).toBe('blocked')
    expect(web.live).toBe(false)
    expect(web.evidenceLevel).toBe('N5')
    expect(web.reason).toBe('os-capture-unavailable')

    const packaged = startOsCapture('packaged')
    expect(packaged.status).toBe('blocked')
    expect(packaged.live).toBe(false)
    expect(packaged.evidenceLevel).toBe('N5')
  })
})
