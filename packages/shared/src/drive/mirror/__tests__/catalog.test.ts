import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { scanMirrorCatalog } from '../catalog'
import type { DriveMirrorSliceId, MirrorSlicePolicy } from '../types'

interface WarnSpy {
  mockRestore(): void
  mock: { calls: unknown[][] }
}

const TREE: Record<string, string> = {
  'config.json': '{"theme":"dark"}',
  'preferences.json': '{}',
  'theme.json': '{}',
  'themes/dark.json': '{}',
  'themes/deep/nested.json': '{}',
  'workspaces/alpha/config.json': '{}',
  'workspaces/alpha/permissions.json': '{}',
  'workspaces/alpha/skills/my-skill/SKILL.md': '# skill',
  'workspaces/alpha/sources/src/config.json': '{}',
  'workspaces/alpha/pages/index.html': '<html></html>',
  'workspaces/alpha/sessions/s-1/session.jsonl': '{"type":"header"}',
  'keeper/personal/vault.json': '{"cipher":"..."}',
  'keeper/personal/vault.key.enc': 'wrapped-key',
  'drive/notes.json': '{}',
  'meetings/m-1.json': '{}',
  'clipboard/clip.json': '{}',
  'node_modules/pkg/index.js': 'module.exports = {}',
  'tmp/scratch.json': '{}',
  '.DS_Store': 'junk',
  'config.json.lock': '',
}

/** Expected mirrored paths with their slice ids (default policies). */
const EXPECTED: Record<string, DriveMirrorSliceId> = {
  'config.json': 'settings',
  'preferences.json': 'settings',
  'theme.json': 'settings',
  'themes/dark.json': 'settings',
  'themes/deep/nested.json': 'settings',
  'workspaces/alpha/config.json': 'workspaces',
  'workspaces/alpha/permissions.json': 'workspaces',
  'workspaces/alpha/skills/my-skill/SKILL.md': 'workspaces',
  'workspaces/alpha/sources/src/config.json': 'workspaces',
  'workspaces/alpha/pages/index.html': 'workspaces',
  'workspaces/alpha/sessions/s-1/session.jsonl': 'sessions',
  'keeper/personal/vault.json': 'keeper',
}

describe('scanMirrorCatalog', () => {
  let root: string
  let warnSpy: WarnSpy

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mirror-catalog-'))
    for (const [relativePath, content] of Object.entries(TREE)) {
      const full = join(root, relativePath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  test('selects exactly the default slices, sorted and deduplicated', async () => {
    const entries = await scanMirrorCatalog({ configDir: root })
    const byPath = Object.fromEntries(entries.map(entry => [entry.relativePath, entry.sliceId]))

    expect(byPath).toEqual(EXPECTED)
    const paths = entries.map(entry => entry.relativePath)
    expect(paths).toEqual([...paths].sort())
    expect(new Set(paths).size).toBe(paths.length)
    // Skipped: node_modules, tmp, .DS_Store, *.lock.
    expect(paths).not.toContain('node_modules/pkg/index.js')
    expect(paths).not.toContain('tmp/scratch.json')
    expect(paths).not.toContain('.DS_Store')
    expect(paths).not.toContain('config.json.lock')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('excludes the device-bound keeper key but mirrors the vault ciphertext', async () => {
    const entries = await scanMirrorCatalog({ configDir: root })
    const paths = entries.map(entry => entry.relativePath)
    expect(paths).toContain('keeper/personal/vault.json')
    expect(paths).not.toContain('keeper/personal/vault.key.enc')
    const vault = entries.find(entry => entry.relativePath === 'keeper/personal/vault.json')
    expect(vault?.sliceId).toBe('keeper')
  })

  test('honest gap: drive, meetings and clipboard are not mirrored by default', async () => {
    const entries = await scanMirrorCatalog({ configDir: root })
    const paths = entries.map(entry => entry.relativePath)
    expect(paths.some(path => path.startsWith('drive/'))).toBe(false)
    expect(paths.some(path => path.startsWith('meetings/'))).toBe(false)
    expect(paths.some(path => path.startsWith('clipboard/'))).toBe(false)
  })

  test('hashes files at or below the slice limit', async () => {
    const entries = await scanMirrorCatalog({ configDir: root })
    const config = entries.find(entry => entry.relativePath === 'config.json')
    const expected = createHash('sha256').update(TREE['config.json']!).digest('hex')
    expect(config?.sha256).toBe(expected)
    expect(config?.sizeBytes).toBe(Buffer.byteLength(TREE['config.json']!))
    expect(config?.absPath).toBe(join(root, 'config.json'))
  })

  test('drops and warns about oversized files instead of mirroring them silently', async () => {
    const policies: MirrorSlicePolicy[] = [
      { sliceId: 'sessions', include: true, patterns: ['workspaces/*/sessions/**'], maxFileBytes: 4 },
    ]
    const entries = await scanMirrorCatalog({ configDir: root, policies })
    expect(entries).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('workspaces/alpha/sessions/s-1/session.jsonl')
  })

  test('keeps a file sitting exactly on the limit', async () => {
    const content = TREE['config.json']!
    const policies: MirrorSlicePolicy[] = [
      { sliceId: 'settings', include: true, patterns: ['config.json'], maxFileBytes: Buffer.byteLength(content) },
    ]
    const entries = await scanMirrorCatalog({ configDir: root, policies })
    expect(entries.map(entry => entry.relativePath)).toEqual(['config.json'])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('is deterministic across runs', async () => {
    const first = await scanMirrorCatalog({ configDir: root })
    const second = await scanMirrorCatalog({ configDir: root })
    expect(second.map(entry => entry.relativePath)).toEqual(first.map(entry => entry.relativePath))
  })

  test('an include:false policy selects nothing even when it matches', async () => {
    const policies: MirrorSlicePolicy[] = [
      { sliceId: 'keeper', include: false, patterns: ['keeper/**'], maxFileBytes: 1024 },
    ]
    const entries = await scanMirrorCatalog({ configDir: root, policies })
    expect(entries).toEqual([])
  })
})