import { describe, expect, it } from 'bun:test'
import {
  compareSemver,
  shouldAcceptReadyUpdate,
  shouldSuppressUpdateFeed,
} from '../auto-update-policy'
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

  it('suppresses ad-hoc signed builds', () => {
    expect(
      shouldSuppressUpdateFeed({
        craftDevRuntime: undefined,
        homeDir: home,
        execPath: '/Applications/Rox.app/Contents/MacOS/Rox',
        isAdHocSigned: true,
      }),
    ).toBe(true)
  })

  it('allows production /Applications without CRAFT_DEV_RUNTIME', () => {
    expect(
      shouldSuppressUpdateFeed({
        craftDevRuntime: undefined,
        homeDir: home,
        execPath: '/Applications/Rox.app/Contents/MacOS/Rox',
        isAdHocSigned: false,
      }),
    ).toBe(false)
  })
})

describe('shouldAcceptReadyUpdate', () => {
  it('rejects when local already matches feed', () => {
    expect(
      shouldAcceptReadyUpdate({ localVersion: '0.12.0', feedVersion: '0.12.0' }),
    ).toBe(false)
  })

  it('rejects when local is newer than feed', () => {
    expect(
      shouldAcceptReadyUpdate({ localVersion: '0.12.1', feedVersion: '0.12.0' }),
    ).toBe(false)
  })

  it('rejects when cached version mismatches feed', () => {
    expect(
      shouldAcceptReadyUpdate({
        localVersion: '0.11.5',
        feedVersion: '0.12.0',
        cachedVersion: '0.11.9',
      }),
    ).toBe(false)
  })

  it('accepts when local behind feed and cache matches (or unknown)', () => {
    expect(
      shouldAcceptReadyUpdate({ localVersion: '0.11.5', feedVersion: '0.12.0' }),
    ).toBe(true)
    expect(
      shouldAcceptReadyUpdate({
        localVersion: '0.11.5',
        feedVersion: '0.12.0',
        cachedVersion: '0.12.0',
      }),
    ).toBe(true)
  })
})

describe('compareSemver', () => {
  it('orders versions', () => {
    expect(compareSemver('0.11.5', '0.12.0')).toBe(-1)
    expect(compareSemver('0.12.0', '0.12.0')).toBe(0)
    expect(compareSemver('v0.12.1', '0.12.0')).toBe(1)
  })
})
