/**
 * Durable error log (`errorLog` in ../logger).
 *
 * In packaged builds the Electron file/console transports are disabled, so
 * main-process errors must land in `<config>/logs/errors.log` instead. These
 * tests exercise the real module: the config root comes from the test preload
 * (`scripts/test-config-isolation.ts`), and `electron-log/main` (which pulls
 * the Electron runtime, absent in CI clones) is stubbed so the module loads.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const noop = () => {}

// Test seam: electron-log/main requires the Electron runtime.
const stubScope = () => ({
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  verbose: noop,
  silly: noop,
  log: noop,
})
const fakeLogger = {
  transports: {
    file: { format: null as unknown, maxSize: 0, level: 'debug' as unknown, getFile: () => undefined },
    console: { format: null as unknown, level: 'debug' as unknown },
  },
  scope: stubScope,
}
mock.module('electron-log/main', () => ({ default: fakeLogger }))

// Must be dynamic: `mock.module` has to be registered before ../logger is
// evaluated, so a static import (hoisted above the mock) cannot work here.
const { errorLog, errorLogPath, getErrorLogFilePath, autoUpdateLog, autoUpdateLogPath } =
  await import('../logger')

// Silence the debug-mode console mirror so test output stays clean.
fakeLogger.transports.console.level = false

type LogEntry = {
  timestamp: string
  level: string
  scope: string
  message: string
  meta?: Record<string, unknown>
}

function readEntries(path: string): LogEntry[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

describe('errorLog', () => {
  beforeEach(() => {
    rmSync(errorLogPath, { force: true })
    rmSync(`${errorLogPath}.1`, { force: true })
  })

  it('lives under <config>/logs and is discoverable by path', () => {
    expect(errorLogPath.endsWith(join('logs', 'errors.log'))).toBe(true)
    expect(getErrorLogFilePath()).toBe(errorLogPath)
  })

  it('writes one valid JSON entry with level, scope, message and meta', () => {
    errorLog.error('boom', { code: 42 })

    const entries = readEntries(errorLogPath)
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('error')
    expect(entries[0].scope).toBe('errors')
    expect(entries[0].message).toBe('boom')
    expect(entries[0].meta?.code).toBe(42)
    expect(typeof entries[0].timestamp).toBe('string')
  })

  it('persists Error objects as message + stack in meta', () => {
    errorLog.error('[captureError]', { error: new Error('kaboom') })

    const [entry] = readEntries(errorLogPath)
    const err = entry.meta?.error
    if (!err || typeof err !== 'object' || !('message' in err) || !('stack' in err)) {
      throw new Error('expected error meta with message and stack')
    }
    expect(err.message).toBe('kaboom')
    expect(String(err.stack)).toContain('kaboom')
  })

  it('redacts credential-named keys and URL query values before writing', () => {
    errorLog.error('leak', {
      authorization: 'Bearer supersecret-token',
      url: 'https://api.example.com/v1/thing?api_key=sekret&x=1',
      nested: { cookie: 'session=abc' },
    })

    const raw = readFileSync(errorLogPath, 'utf8')
    expect(raw).not.toContain('supersecret-token')
    expect(raw).not.toContain('sekret')
    expect(raw).not.toContain('session=abc')

    const [entry] = readEntries(errorLogPath)
    expect(entry.meta?.authorization).toBe('[REDACTED]')
    expect(entry.meta?.url).toBe('https://api.example.com/v1/thing?api_key=[REDACTED]&x=[REDACTED]')

    const nested = entry.meta?.nested
    if (!nested || typeof nested !== 'object' || !('cookie' in nested)) {
      throw new Error('expected nested cookie meta')
    }
    expect(nested.cookie).toBe('[REDACTED]')
  })

  it('rotates to a .1 backup once the 5MB limit would be exceeded', () => {
    for (let i = 0; i < 6; i += 1) {
      errorLog.error('bulk', { blob: 'x'.repeat(1_000_000) })
    }

    expect(existsSync(`${errorLogPath}.1`)).toBe(true)
    expect(existsSync(errorLogPath)).toBe(true)
  })
})

describe('autoUpdateLog', () => {
  beforeEach(() => {
    rmSync(autoUpdateLogPath, { force: true })
    rmSync(`${autoUpdateLogPath}.1`, { force: true })
  })

  it('keeps its unchanged JSON entry shape and passes meta through unredacted', () => {
    autoUpdateLog.error('update failed', { reason: 'boom', token: 'plain' })

    const [entry] = readEntries(autoUpdateLogPath)
    expect(entry.scope).toBe('auto-update')
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('update failed')
    expect(entry.meta?.reason).toBe('boom')
    expect(entry.meta?.token).toBe('plain')
  })
})