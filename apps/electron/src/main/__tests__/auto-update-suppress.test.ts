import { describe, expect, it } from 'bun:test'
import { shouldSuppressUpdateFeed } from '../auto-update-policy'
import { join } from 'path'

describe('shouldSuppressUpdateFeed', () => {
  const home = '/Users/mark'

  it('suppresses when CRAFT_DEV_RUNTIME is set', () => {
    expect(
      shouldSuppressUpdateFeed({
        craftDevRuntime: '1',
        homeDir: home,
        execPath: '/Applications/Rox.app/Contents/MacOS/Rox',
      }),
    ).toBe(true)
  })

  it('suppresses ~/Applications installs', () => {
    expect(
      shouldSuppressUpdateFeed({
        craftDevRuntime: '',
        homeDir: home,
        execPath: join(home, 'Applications', 'Rox.app', 'Contents', 'MacOS', 'Rox'),
      }),
    ).toBe(true)
  })

  it('allows production /Applications without CRAFT_DEV_RUNTIME', () => {
    expect(
      shouldSuppressUpdateFeed({
        craftDevRuntime: undefined,
        homeDir: home,
        execPath: '/Applications/Rox.app/Contents/MacOS/Rox',
      }),
    ).toBe(false)
  })
})
