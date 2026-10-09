import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

import { resolveBrowserIntelPaths, stagingDirForProfile } from '../../paths.ts'
import { cleanupAllStaging, cleanupStagingDir, shadowCopyProfile, stagingBytes } from '../shadowCopy.ts'
import type { ScannedBrowserProfile } from '../../types.ts'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeProfileFixture(): {
  profile: ScannedBrowserProfile
  paths: ReturnType<typeof resolveBrowserIntelPaths>
  historyPath: string
  bookmarksPath: string
} {
  const base = mkdtempSync(join(tmpdir(), 'browser-intel-acq-'))
  temporaryRoots.push(base)
  const profileDir = join(base, 'profile')
  mkdirSync(profileDir, { recursive: true })
  const paths = resolveBrowserIntelPaths(join(base, 'config'))
  const historyPath = join(profileDir, 'History')
  const bookmarksPath = join(profileDir, 'Bookmarks')
  const profile: ScannedBrowserProfile = {
    profileId: `chromium:${profileDir}`,
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Google Chrome',
    name: 'Default',
    path: profileDir,
    lastUsedAt: null,
    state: 'ok',
    stores: { history: historyPath, bookmarks: bookmarksPath, places: null, cookies: null },
  }
  return { profile, paths, historyPath, bookmarksPath }
}

describe('shadowCopyProfile', () => {
  test('copies stores and WAL siblings into a staging dir inside the staging root', async () => {
    const { profile, paths, historyPath, bookmarksPath } = makeProfileFixture()
    const history = Buffer.from('history-contents-'.repeat(32))
    const bookmarks = '{"roots":{}}'
    writeFileSync(historyPath, history)
    writeFileSync(`${historyPath}-wal`, 'wal-data')
    writeFileSync(`${historyPath}-journal`, 'journal-data')
    writeFileSync(bookmarksPath, bookmarks)

    const result = await shadowCopyProfile(profile, { paths })

    expect(result.files.map((file) => file.kind).sort()).toEqual(['bookmarks', 'history'])
    const historyFile = result.files.find((file) => file.kind === 'history')!
    expect(historyFile.bytes).toBe(history.length)
    expect(historyFile.sha256).toBe(createHash('sha256').update(history).digest('hex'))
    expect(historyFile.mtimeMs).toBe(statSync(historyPath).mtimeMs)
    expect(historyFile.stagedPath).toBe(join(result.stagingDir, 'History'))

    // Auxiliary siblings copied, but never listed as stores.
    expect(existsSync(join(result.stagingDir, 'History-wal'))).toBe(true)
    expect(existsSync(join(result.stagingDir, 'History-journal'))).toBe(true)
    expect(
      result.files.some((file) => file.stagedPath.endsWith('-wal') || file.stagedPath.endsWith('-journal')),
    ).toBe(false)

    // Absent stores are recorded, not fatal.
    expect([...result.missing].sort()).toEqual(['cookies', 'places'])
    expect(result.totalBytes).toBe(history.length + Buffer.byteLength(bookmarks))

    // The staging dir is strictly inside the staging root.
    const rel = relative(paths.stagingDir, result.stagingDir)
    expect(rel.startsWith('..')).toBe(false)
    expect(isAbsolute(rel)).toBe(false)
    expect(result.stagingDir).toBe(stagingDirForProfile(paths, profile.profileId))
  })

  test('moves an oversized store to missing instead of copying it', async () => {
    const { profile, paths, historyPath, bookmarksPath } = makeProfileFixture()
    writeFileSync(historyPath, Buffer.from('0123456789'))
    writeFileSync(bookmarksPath, 'ok')
    const notes: string[] = []

    const result = await shadowCopyProfile(profile, { paths, maxBytesPerFile: 4, onError: (note) => notes.push(note) })

    expect(result.files.some((file) => file.kind === 'history')).toBe(false)
    expect(result.missing).toContain('history')
    expect(result.files.some((file) => file.kind === 'bookmarks')).toBe(true)
    expect(notes.some((note) => note.includes('maxBytesPerFile'))).toBe(true)
  })

  test('replace clears a stale staging directory', async () => {
    const { profile, paths, historyPath, bookmarksPath } = makeProfileFixture()
    writeFileSync(historyPath, 'history')
    writeFileSync(bookmarksPath, '{"roots":{}}')
    const stagingDir = stagingDirForProfile(paths, profile.profileId)
    mkdirSync(stagingDir, { recursive: true })
    const stale = join(stagingDir, 'stale.txt')
    writeFileSync(stale, 'stale')

    await shadowCopyProfile(profile, { paths })
    expect(existsSync(stale)).toBe(false)
  })

  test('cleanupStagingDir removes the tree', async () => {
    const { profile, paths, historyPath, bookmarksPath } = makeProfileFixture()
    writeFileSync(historyPath, 'history')
    writeFileSync(`${historyPath}-journal`, 'journal')
    writeFileSync(bookmarksPath, '{"roots":{}}')
    await shadowCopyProfile(profile, { paths })
    const stagingDir = stagingDirForProfile(paths, profile.profileId)
    expect(existsSync(stagingDir)).toBe(true)
    expect(existsSync(join(stagingDir, 'History-journal'))).toBe(true)

    expect(cleanupStagingDir(paths, profile.profileId)).toBe(true)
    expect(existsSync(join(stagingDir, 'History-journal'))).toBe(false)
    expect(existsSync(stagingDir)).toBe(false)
  })

  test('stagingBytes and cleanupAllStaging cover every staged profile', async () => {
    const { profile, paths, historyPath, bookmarksPath } = makeProfileFixture()
    writeFileSync(historyPath, 'history')
    writeFileSync(bookmarksPath, '{"roots":{}}')
    await shadowCopyProfile(profile, { paths })

    expect(stagingBytes(paths)).toBeGreaterThan(0)
    expect(cleanupAllStaging(paths)).toBe(1)
    expect(stagingBytes(paths)).toBe(0)
  })

  test('reports progress per copied store', async () => {
    const { profile, paths, historyPath, bookmarksPath } = makeProfileFixture()
    writeFileSync(historyPath, 'history')
    writeFileSync(bookmarksPath, '{"roots":{}}')
    const seen: string[] = []

    await shadowCopyProfile(profile, {
      paths,
      onProgress: (file) => seen.push(file.kind),
    })
    expect(seen.sort()).toEqual(['bookmarks', 'history'])
  })
})