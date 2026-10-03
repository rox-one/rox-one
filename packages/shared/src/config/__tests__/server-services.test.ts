import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getServerServiceKey, SERVER_SERVICE_KEYS } from '../server-services.ts'

describe('backend service credentials', () => {
  let dir: string
  let previous: Record<string, string | undefined>
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rox-server-services-'))
    previous = Object.fromEntries([...SERVER_SERVICE_KEYS, 'ROX_SERVICE_SECRETS_FILE'].map((name) => [name, process.env[name]]))
    for (const name of SERVER_SERVICE_KEYS) delete process.env[name]
    process.env.ROX_SERVICE_SECRETS_FILE = join(dir, 'private.env')
  })
  afterEach(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(dir, { recursive: true, force: true })
  })
  it('reads every service from a real multiline LF/CRLF private file', () => {
    writeFileSync(join(dir, 'private.env'), '# backend only\nDEEPGRAM_API_KEY=fixture-speech\r\nEXA_API_KEY=fixture-search\nexport BRAVE_API_KEY="fixture-brave"\nE2B_API_KEY=fixture-sandbox\n', { mode: 0o600 })
    expect(getServerServiceKey('DEEPGRAM_API_KEY')).toBe('fixture-speech')
    expect(getServerServiceKey('EXA_API_KEY')).toBe('fixture-search')
    expect(getServerServiceKey('BRAVE_API_KEY')).toBe('fixture-brave')
    expect(getServerServiceKey('E2B_API_KEY')).toBe('fixture-sandbox')
    expect(getServerServiceKey('FIRECRAWL_API_KEY')).toBeUndefined()
  })
  it('honors backend environment overrides without reading a file', () => {
    process.env.EXA_API_KEY = ' fixture-override '
    expect(getServerServiceKey('EXA_API_KEY')).toBe('fixture-override')
    expect(getServerServiceKey('BRAVE_API_KEY')).toBeUndefined()
  })
  it('does not retain replaced credentials in a process cache', () => {
    const path = join(dir, 'private.env')
    writeFileSync(path, 'EXA_API_KEY=old-fixture\n', { mode: 0o600 })
    expect(getServerServiceKey('EXA_API_KEY')).toBe('old-fixture')
    writeFileSync(path, 'EXA_API_KEY=new-fixture\n', { mode: 0o600 })
    expect(getServerServiceKey('EXA_API_KEY')).toBe('new-fixture')
  })
  it('rejects public permissions and excessive contents without exposing values', () => {
    const path = join(dir, 'private.env')
    writeFileSync(path, 'EXA_API_KEY=must-not-appear-in-error\n', { mode: 0o600 })
    if (process.platform !== 'win32') {
      chmodSync(path, 0o644)
      expect(() => getServerServiceKey('EXA_API_KEY')).toThrow('private permissions')
      chmodSync(path, 0o600)
    }
    writeFileSync(path, 'x'.repeat(65 * 1024))
    expect(() => getServerServiceKey('EXA_API_KEY')).toThrow('Invalid service secret file')
  })
  it('rejects directories and symlink substitutions', () => {
    mkdirSync(join(dir, 'private.env'))
    expect(() => getServerServiceKey('EXA_API_KEY')).toThrow()
    rmSync(join(dir, 'private.env'), { recursive: true })
    writeFileSync(join(dir, 'other.env'), 'EXA_API_KEY=fixture\n', { mode: 0o600 })
    if (process.platform !== 'win32') {
      symlinkSync(join(dir, 'other.env'), join(dir, 'private.env'))
      expect(() => getServerServiceKey('EXA_API_KEY')).toThrow('Cannot read the private service secret file')
    }
  })
})
