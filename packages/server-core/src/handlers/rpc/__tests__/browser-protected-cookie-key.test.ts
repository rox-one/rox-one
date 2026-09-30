import { expect, test } from 'bun:test'
import { deleteProtectedCookieKey } from '../browser-protected-cookie-key.ts'

test('Darwin accepts only native success or item-not-found and keeps account out of script source', () => {
  const reference = 'synthetic-"; do not execute'
  for (const status of ['0', '-25300']) {
    expect(deleteProtectedCookieKey(reference, 'darwin', (file, args, options) => {
      if (file === '/usr/bin/security') return { status: 44 }
      expect(file).toBe('/usr/bin/osascript')
      expect(args.at(-1)).toBe(reference)
      expect(args[3]).not.toContain(reference)
      expect(options.timeout).toBe(5000)
      return { status: 0, stdout: status + '\n' }
    })).toBe(true)
  }
  for (const output of ['44', '-25293', '-25308', '-25291', '-50', '', '0\n-25300', 'unknown']) {
    expect(deleteProtectedCookieKey('synthetic', 'darwin', file => file === '/usr/bin/security' ? { status: 44 } : { status: 0, stdout: output })).toBe(false)
  }
  expect(deleteProtectedCookieKey('synthetic', 'darwin', () => ({ status: 44, stdout: '-25300' }))).toBe(false)
  expect(deleteProtectedCookieKey('synthetic', 'darwin', file => file === '/usr/bin/security' ? { status: 44 } : { status: 0, stdout: '-25300', signal: 'SIGTERM' })).toBe(false)
  expect(deleteProtectedCookieKey('synthetic', 'darwin', () => { throw Error('unavailable') })).toBe(false)
})

test('Darwin successful exact deletion needs no fallback; CLI failures require native proof', () => {
  let calls = 0
  expect(deleteProtectedCookieKey('synthetic', 'darwin', file => { calls++; expect(file).toBe('/usr/bin/security'); return { status: 0 } })).toBe(true)
  expect(calls).toBe(1)
  for (const cliStatus of [44, 1, null]) {
    expect(deleteProtectedCookieKey('synthetic', 'darwin', file => file === '/usr/bin/security'
      ? { status: cliStatus } : { status: 0, stdout: '-25244' })).toBe(false)
  }
})

test('Linux ambiguous absence or locked failure stays denied, even without stderr', () => {
  expect(deleteProtectedCookieKey('synthetic', 'linux', () => ({ status: 0 }))).toBe(true)
  expect(deleteProtectedCookieKey('synthetic', 'linux', () => ({ status: 1, stdout: '' }))).toBe(false)
  expect(deleteProtectedCookieKey('synthetic', 'linux', () => ({ status: null, error: Error('not installed') }))).toBe(false)
  expect(deleteProtectedCookieKey('synthetic', 'win32', () => { throw Error('must not execute') })).toBe(false)
})
