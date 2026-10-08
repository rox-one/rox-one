import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { seedSourceToolchainRoot } from './rox-readiness-ui-001.source-toolchain.ts'

const home = '/home/tester'

describe('seedSourceToolchainRoot (W1-13)', () => {
  it('never returns the disposable profile from ROX_CONFIG_DIR', () => {
    const profile = '/work/rox-readiness-ui-001-abc'
    const root = seedSourceToolchainRoot({ ROX_CONFIG_DIR: profile }, home, () => false)
    expect(root).toBe(join(home, '.rox', 'toolchain'))
    expect(root.startsWith(profile)).toBe(false)
  })

  it('explicit ROX_SEED_SOURCE_TOOLCHAIN wins', () => {
    expect(seedSourceToolchainRoot({ ROX_SEED_SOURCE_TOOLCHAIN: '/opt/tc' }, home, () => true)).toBe('/opt/tc')
  })

  it('prefers a visible ~/rox toolchain, else the legacy hidden home', () => {
    const visibleState = join(home, 'rox', 'toolchain', 'state.json')
    expect(seedSourceToolchainRoot({}, home, (path) => path === visibleState)).toBe(join(home, 'rox', 'toolchain'))
    expect(seedSourceToolchainRoot({}, home, () => false)).toBe(join(home, '.rox', 'toolchain'))
  })
})
