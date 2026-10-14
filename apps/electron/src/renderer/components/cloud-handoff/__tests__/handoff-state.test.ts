import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { failureLabelKey, hasLiveSession, isHandoffInFlight, needsUserKey, safeSessionUrl, withoutLink } from '../handoff-state'

const base = { handoffId: 'h', sessionId: 's', startedAt: 0, updatedAt: 0 }

describe('cloud handoff view model', () => {
  it('tracks in-flight phases', () => {
    expect(isHandoffInFlight({ ...base, phase: 'uploading' })).toBe(true)
    expect(isHandoffInFlight({ ...base, phase: 'ready' })).toBe(false)
    expect(isHandoffInFlight(null)).toBe(false)
  })
  it('maps unknown failure codes to a generic message', () => {
    expect(failureLabelKey('no_key')).toBe('cloudHandoff.error.no_key')
    expect(failureLabelKey('weird')).toBe('cloudHandoff.error.provider_error')
  })
  it('asks for a key only when neither user nor default key exists', () => {
    const cfg = { enabled: true, userKeyConfigured: false, brokerConfigured: false, ssoConfigured: true, webHostConfigured: false }
    expect(needsUserKey(cfg)).toBe(true)
    expect(needsUserKey({ ...cfg, brokerConfigured: true })).toBe(false)
  })
  it('only opens https links for ready sessions', () => {
    expect(safeSessionUrl({ ...base, phase: 'ready', sessionUrl: 'https://cloud.rox.one/s/x/' })).toBe('https://cloud.rox.one/s/x/')
    expect(safeSessionUrl({ ...base, phase: 'ready', sessionUrl: 'javascript:alert(1)' })).toBeNull()
    expect(safeSessionUrl({ ...base, phase: 'uploading', sessionUrl: 'https://x/' })).toBeNull()
  })
  it('treats ended sessions as gone and strips links from stored state', () => {
    const ready = { ...base, phase: 'ready' as const, sessionUrl: 'https://x.example/' }
    expect(hasLiveSession(ready)).toBe(true)
    expect(hasLiveSession({ ...ready, ended: true })).toBe(false)
    expect(safeSessionUrl({ ...ready, ended: true })).toBeNull()
    expect(withoutLink(ready)).not.toHaveProperty('sessionUrl')
  })
  it('never renders the Daytona key back and stays hidden behind the flag', () => {
    const src = readFileSync(join(__dirname, '../CloudHandoffButton.tsx'), 'utf8')
    expect(src).toContain('if (!config?.enabled) return null')
    expect(src).toContain('type="password"')
    expect(src).not.toMatch(/getCloudHandoffKey|apiKey/)
    expect(src).not.toMatch(/title=\{url\}/)
  })
})
