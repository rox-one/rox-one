import { describe, expect, it, mock } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { electronMockExports } from './electron-mock-exports'

mock.module('electron', () => ({ ...electronMockExports }))

const { normalizeAbsolutePath, closeQuickLookPath } = await import('../files-actions')

describe('normalizeAbsolutePath', () => {
  it('resolves absolute paths', () => {
    expect(normalizeAbsolutePath('/tmp/notes/a.md')).toBe('/tmp/notes/a.md')
  })

  it('expands a leading tilde', () => {
    expect(normalizeAbsolutePath('~/notes')).toBe(join(homedir(), 'notes'))
    expect(normalizeAbsolutePath('~')).toBe(homedir())
  })

  it('rejects relative, empty and malformed input', () => {
    expect(normalizeAbsolutePath('relative/path')).toBeNull()
    expect(normalizeAbsolutePath('')).toBeNull()
    expect(normalizeAbsolutePath('   ')).toBeNull()
    expect(normalizeAbsolutePath('/tmp/a\u0000b')).toBeNull()
    expect(normalizeAbsolutePath(42)).toBeNull()
    expect(normalizeAbsolutePath(null)).toBeNull()
  })
})

describe('quick look close', () => {
  it('is a no-op when no preview is tracked', () => {
    expect(closeQuickLookPath()).toEqual({ ok: true })
  })
})