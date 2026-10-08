/**
 * W1-13 (#1510) review 3 (finding 6): the persisted `storage.visible-root.v1`
 * flag file must not move when a foreign or empty `~/rox` appears.
 *
 * SAFETY: temp HOME (`mkdtemp`) + explicit `homeDir`/`env` only.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  migrateHiddenRoxHome,
  readPersistedVisibleRootFlag,
  visibleRootFlagFilePath,
  writePersistedVisibleRootFlag,
} from '../config-migration.ts'
import {
  isVisibleRoxHomeActive,
  resetConfigDirCachesForTests,
  resolveConfigDir,
  runVisibleHomeAutoMigration,
} from '../../config/env.ts'

beforeEach(() => resetConfigDirCachesForTests())

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'rox-flag-location-'))
  try {
    run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
    resetConfigDirCachesForTests()
  }
}
const opts = (home: string) => ({ homeDir: home, env: {}, timestamp: 'ts-flag', skipProcessLock: true,
  desktopRuntimeLockPath: (dir: string) => join(home, `runtime-${dir.endsWith('.rox') ? 'hidden' : 'visible'}.lock`) })
const plantHidden = (home: string): void => {
  mkdirSync(join(home, '.rox', 'workspaces', 'real'), { recursive: true })
  writeFileSync(join(home, '.rox', 'config.json'), '{"workspaces":[{"id":"real"}]}')
}

describe('persisted flag location (finding 6)', () => {
  it('repro: a foreign ~/rox appearing after the toggle keeps the flag ON and is never written to', () =>
    withHome((home) => {
      plantHidden(home)
      writePersistedVisibleRootFlag(true, home)
      expect(visibleRootFlagFilePath(home)).toBe(join(home, '.rox', 'workbench-flags.json'))
      mkdirSync(join(home, 'rox'))
      writeFileSync(join(home, 'rox', 'README.md'), '# my project')
      expect(readPersistedVisibleRootFlag(home)).toBe(true)
      expect(isVisibleRoxHomeActive({}, home)).toBe(true)
      expect(resolveConfigDir({}, home)).toBe(join(home, '.rox'))
      expect(runVisibleHomeAutoMigration({ env: {}, homeDir: home })?.result?.outcome).toBe('deferred-foreign')
      writePersistedVisibleRootFlag(true, home) // a second toggle also stays in the legacy file
      expect(readdirSync(join(home, 'rox'))).toEqual(['README.md'])
    }))

  it('an empty ~/rox does not move the flag either; a Rox-home ~/rox does', () =>
    withHome((home) => {
      plantHidden(home)
      writePersistedVisibleRootFlag(true, home)
      mkdirSync(join(home, 'rox'))
      expect(readPersistedVisibleRootFlag(home)).toBe(true)
      writeFileSync(join(home, 'rox', 'config.json'), '{}')
      // ~/rox is a Rox home now but has no flag file: the existing legacy one still counts.
      expect(visibleRootFlagFilePath(home)).toBe(join(home, '.rox', 'workbench-flags.json'))
      writeFileSync(join(home, 'rox', 'workbench-flags.json'), '{"enabled":[]}')
      expect(visibleRootFlagFilePath(home)).toBe(join(home, 'rox', 'workbench-flags.json'))
      expect(readPersistedVisibleRootFlag(home)).toBe(false)
    }))

  it('after a migration the flag is read from ~/rox (same file through the compat link)', () =>
    withHome((home) => {
      plantHidden(home)
      writePersistedVisibleRootFlag(true, home)
      expect(migrateHiddenRoxHome(opts(home)).outcome).toBe('migrated')
      expect(visibleRootFlagFilePath(home)).toBe(join(home, 'rox', 'workbench-flags.json'))
      expect(readPersistedVisibleRootFlag(home)).toBe(true)
    }))
})
