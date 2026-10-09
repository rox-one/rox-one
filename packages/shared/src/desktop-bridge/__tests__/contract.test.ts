import { describe, expect, it } from 'bun:test'
import {
  ROX_DESKTOP_BRIDGE_METHODS,
  ROX_DESKTOP_BRIDGE_REGISTRY,
  ROX_DESKTOP_BRIDGE_VERSION,
  isRoxDesktopBridgeMethod,
  validateRoxDesktopBridgeRequest,
} from '../contract'

describe('ROX desktop bridge contract registry', () => {
  it('registers every method exactly once', () => {
    const names = ROX_DESKTOP_BRIDGE_METHODS
    expect(new Set(names).size).toBe(names.length)
    expect(ROX_DESKTOP_BRIDGE_REGISTRY.map(entry => entry.method)).toEqual([...names])
    expect(ROX_DESKTOP_BRIDGE_REGISTRY.every(entry => entry.version === ROX_DESKTOP_BRIDGE_VERSION)).toBe(true)
  })

  it('exposes exactly the documented methods', () => {
    expect([...ROX_DESKTOP_BRIDGE_METHODS]).toEqual([
      'browser.open',
      'browser.navigate',
      'browser.releaseScope',
      'device.permissionStatus',
      'app.openLink',
      'gateway.status',
      'notifications.show',
    ])
    expect(isRoxDesktopBridgeMethod('browser.open')).toBe(true)
    expect(isRoxDesktopBridgeMethod('browser.unknown')).toBe(false)
  })
})

describe('ROX desktop bridge validator', () => {
  it('accepts a version-1 envelope and forwards params', () => {
    const params = { url: 'https://example.invalid/' }
    expect(validateRoxDesktopBridgeRequest({ v: 1, method: 'browser.navigate', params })).toEqual({
      ok: true,
      method: 'browser.navigate',
      params,
    })
  })

  it('refuses an unknown method typed, with the method name echoed', () => {
    const result = validateRoxDesktopBridgeRequest({ v: 1, method: 'browser.definitely-not-real' })
    expect(result).toEqual({
      ok: false,
      code: 'ROX_DESKTOP_BRIDGE_UNKNOWN_METHOD',
      expectedVersion: 1,
      receivedVersion: 1,
      method: 'browser.definitely-not-real',
    })
  })

  it('refuses a non-current version typed, even for a registered method', () => {
    const result = validateRoxDesktopBridgeRequest({ v: 2, method: 'app.openLink' })
    expect(result).toEqual({
      ok: false,
      code: 'ROX_DESKTOP_BRIDGE_VERSION_MISMATCH',
      expectedVersion: 1,
      receivedVersion: 2,
      method: 'app.openLink',
    })
  })

  it('refuses malformed envelopes without throwing', () => {
    for (const input of [null, undefined, 42, 'app.openLink', [], { method: 'app.openLink' }, { v: 1 }, { v: '1', method: 'app.openLink' }, { v: 1.5, method: 'app.openLink' }]) {
      const result = validateRoxDesktopBridgeRequest(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('ROX_DESKTOP_BRIDGE_MALFORMED')
    }
  })
})