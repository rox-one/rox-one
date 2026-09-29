import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { LEGACY_SEEDED_WORKSPACE_ICON_SHA256, refreshLegacySeededWorkspaceIcons } from '../brand-icon-migration'

describe('refreshLegacySeededWorkspaceIcons', () => {
  it('only replaces icons that match a legacy seeded brand icon', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brand-icon-'))
    const current = join(dir, 'workspace-icon.png')
    writeFileSync(current, 'NEW')
    const legacy = join(dir, 'legacy'); mkdirSync(legacy)
    const custom = join(dir, 'custom'); mkdirSync(custom)
    const none = join(dir, 'none'); mkdirSync(none)
    // Simulate a legacy seed by registering this content's hash for the test.
    const legacyBytes = 'OLD-SEEDED'
    const legacyHash = createHash('sha256').update(legacyBytes).digest('hex')
    LEGACY_SEEDED_WORKSPACE_ICON_SHA256.add(legacyHash)
    writeFileSync(join(legacy, 'icon.png'), legacyBytes)
    writeFileSync(join(custom, 'icon.png'), 'USER-CHOSEN')
    const out = refreshLegacySeededWorkspaceIcons(
      [{ rootPath: legacy }, { rootPath: custom }, { rootPath: none }, { rootPath: null }],
      current,
    )
    LEGACY_SEEDED_WORKSPACE_ICON_SHA256.delete(legacyHash)
    expect(out).toEqual([legacy])
    expect(readFileSync(join(legacy, 'icon.png'), 'utf8')).toBe('NEW')
    expect(readFileSync(join(custom, 'icon.png'), 'utf8')).toBe('USER-CHOSEN')
  })

  it('is a no-op without a current icon', () => {
    expect(refreshLegacySeededWorkspaceIcons([{ rootPath: '/nope' }], undefined)).toEqual([])
  })
})
