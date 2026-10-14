import { afterEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { RoversError } from '../../errors.ts'
import type { RoversEnginePaths } from '../../types.ts'
import {
  cleanupEngineCache,
  defaultEngineConfig,
  ENGINE_CONFIG_FILENAME,
  engineConfigPath,
  enginePaths,
  ensureEngineDirs,
  readEngineConfig,
  ROVERS_DIRNAME,
  roversDir,
  writeEngineConfig,
} from '../engine.ts'

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-rovers-engine-'))
  tmpDirs.push(dir)
  return dir
}

function makePaths(root: string): RoversEnginePaths {
  const cacheRoot = join(root, 'cache')
  return {
    cacheRoot,
    limaHome: join(cacheRoot, 'lima'),
    home: join(cacheRoot, 'home'),
    xdgCacheHome: join(cacheRoot, 'xdg-cache'),
  }
}

/** Read a config expected to fail, preserving the typed failure for assertions. */
function readConfigError(configDir: string): RoversError {
  try {
    readEngineConfig(configDir)
  } catch (error) {
    if (error instanceof RoversError) return error
    throw error
  }
  throw new Error(`expected readEngineConfig(${configDir}) to throw`)
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('engine config locations', () => {
  it('derives the rovers dir and engine.json path', () => {
    expect(ROVERS_DIRNAME).toBe('rovers')
    expect(ENGINE_CONFIG_FILENAME).toBe('engine.json')
    expect(roversDir('/cfg')).toBe(join('/cfg', 'rovers'))
    expect(engineConfigPath('/cfg')).toBe(join('/cfg', 'rovers', 'engine.json'))
  })

  it('defaults to an engine-private cache tree with no engines', () => {
    const cacheRoot = join('/cfg', 'rovers', 'cache')
    expect(defaultEngineConfig('/cfg')).toEqual({
      schemaVersion: 1,
      cacheRoot,
      limaHome: join(cacheRoot, 'lima'),
      cleanup: { maxAgeDays: 30, onEngineStop: false },
      engines: [],
    })
  })

  it('puts every engine path inside cacheRoot', () => {
    const paths = enginePaths(defaultEngineConfig('/cfg'))
    expect(paths.home).toBe(join(paths.cacheRoot, 'home'))
    expect(paths.xdgCacheHome).toBe(join(paths.cacheRoot, 'xdg-cache'))
    for (const path of [paths.limaHome, paths.home, paths.xdgCacheHome]) {
      expect(path.startsWith(paths.cacheRoot)).toBe(true)
    }
  })
})

describe('readEngineConfig / writeEngineConfig', () => {
  it('returns the defaults when engine.json is missing', () => {
    const configDir = makeTmpDir()
    expect(readEngineConfig(configDir)).toEqual(defaultEngineConfig(configDir))
  })

  it('round-trips a written config and leaves no .tmp file behind', () => {
    const configDir = makeTmpDir()
    const config = defaultEngineConfig(configDir)
    config.engines = [
      { id: 'lima-default', kind: 'local', runtime: 'lima', version: '2.2.1', binaryPath: '/opt/homebrew/bin/limactl' },
    ]

    expect(writeEngineConfig(configDir, config)).toEqual(config)
    expect(readEngineConfig(configDir)).toEqual(config)

    const target = engineConfigPath(configDir)
    expect(statSync(target).mode & 0o777).toBe(0o600)
    expect(readdirSync(roversDir(configDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('throws RoversError no_runtime for corrupt JSON', () => {
    const configDir = makeTmpDir()
    const target = engineConfigPath(configDir)
    mkdirSync(roversDir(configDir), { recursive: true })
    writeFileSync(target, '{ "schemaVersion": 1,')

    const error = readConfigError(configDir)
    expect(error.code).toBe('no_runtime')
    expect(error.message).toBe('Файл engine.json повреждён или несовместим.')
    expect(error.repairAction).toBe(`Удалите ${target}, чтобы Rox пересоздал настройки движка.`)
  })

  it('throws RoversError no_runtime for schema drift', () => {
    const configDir = makeTmpDir()
    mkdirSync(roversDir(configDir), { recursive: true })
    writeFileSync(engineConfigPath(configDir), JSON.stringify({ schemaVersion: 2, cacheRoot: '/x' }))

    expect(readConfigError(configDir).code).toBe('no_runtime')
  })

  it('creates all four engine dirs idempotently', () => {
    const configDir = makeTmpDir()
    const config = defaultEngineConfig(configDir)
    const paths = ensureEngineDirs(config)
    ensureEngineDirs(config)
    for (const dir of [paths.cacheRoot, paths.limaHome, paths.home, paths.xdgCacheHome]) {
      expect(existsSync(dir)).toBe(true)
    }
  })
})

describe('cleanupEngineCache', () => {
  const policy = { maxAgeDays: 30, onEngineStop: false }
  const now = Date.UTC(2026, 9, 14, 12, 0, 0)
  const oldDate = new Date(now - 60 * 86_400_000)

  it('evicts entries older than maxAgeDays and keeps fresh ones', () => {
    const paths = makePaths(makeTmpDir())
    mkdirSync(paths.cacheRoot, { recursive: true })

    const oldFile = join(paths.cacheRoot, 'old-image')
    writeFileSync(oldFile, 'old-data')
    utimesSync(oldFile, oldDate, oldDate)

    const oldDir = join(paths.cacheRoot, 'old-instance')
    mkdirSync(oldDir)
    writeFileSync(join(oldDir, 'disk.img'), 'nested-data')
    utimesSync(oldDir, oldDate, oldDate)

    const freshFile = join(paths.cacheRoot, 'fresh-image')
    writeFileSync(freshFile, 'fresh')

    const result = cleanupEngineCache(paths, policy, { now })

    expect([...result.removed].sort()).toEqual([resolve(oldFile), resolve(oldDir)].sort())
    expect(result.bytesFreed).toBe('old-data'.length + 'nested-data'.length)
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
    expect(existsSync(paths.cacheRoot)).toBe(true)
  })

  it('never evicts a kept path', () => {
    const paths = makePaths(makeTmpDir())
    mkdirSync(paths.cacheRoot, { recursive: true })
    const kept = join(paths.cacheRoot, 'active-instance')
    mkdirSync(kept)
    writeFileSync(join(kept, 'disk.img'), 'keep-me')
    utimesSync(kept, oldDate, oldDate)

    const result = cleanupEngineCache(paths, policy, { now, keep: [kept] })

    expect(result).toEqual({ removed: [], bytesFreed: 0 })
    expect(existsSync(kept)).toBe(true)
  })

  it('is a no-op when maxAgeDays is zero', () => {
    const paths = makePaths(makeTmpDir())
    mkdirSync(paths.cacheRoot, { recursive: true })
    const oldFile = join(paths.cacheRoot, 'old-image')
    writeFileSync(oldFile, 'old-data')
    utimesSync(oldFile, oldDate, oldDate)

    expect(cleanupEngineCache(paths, { maxAgeDays: 0, onEngineStop: true }, { now })).toEqual({
      removed: [],
      bytesFreed: 0,
    })
    expect(existsSync(oldFile)).toBe(true)
  })

  it('returns an empty result when the cache root does not exist', () => {
    const paths = makePaths(makeTmpDir())
    expect(cleanupEngineCache(paths, policy, { now })).toEqual({ removed: [], bytesFreed: 0 })
  })
})
