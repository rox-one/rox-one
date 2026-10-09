import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import {
  isWalResetSafeSqliteVersion,
  probeRuntimeCapabilities,
  resolveUserSpaceRuntimeFallback,
  type ProbeDatabase,
  type RuntimeVersionSummary,
} from '../capability-probe.ts'

function withConfigDir<T>(run: (configDir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'rox-cap-probe-test-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SAFE_VERSIONS: RuntimeVersionSummary = {
  runtime: 'bun',
  runtimeVersion: '1.4.2',
  nodeVersion: '26.3.0',
  platform: process.platform,
  sqliteVersion: '3.54.0',
}

describe('isWalResetSafeSqliteVersion', () => {
  it('accepts the documented safe ranges and rejects the gaps', () => {
    expect(isWalResetSafeSqliteVersion('3.51.3')).toBe(true)
    expect(isWalResetSafeSqliteVersion('3.50.7')).toBe(true)
    expect(isWalResetSafeSqliteVersion('3.44.6')).toBe(true)
    expect(isWalResetSafeSqliteVersion('4.0.0')).toBe(true)
    expect(isWalResetSafeSqliteVersion('3.51.2')).toBe(false)
    expect(isWalResetSafeSqliteVersion('3.50.6')).toBe(false)
    expect(isWalResetSafeSqliteVersion('3.44.5')).toBe(false)
    expect(isWalResetSafeSqliteVersion('3.45.0')).toBe(false)
    expect(isWalResetSafeSqliteVersion('not-a-version')).toBe(false)
  })
})

describe('resolveUserSpaceRuntimeFallback', () => {
  it('locates the runtime under <state>/tools and describes how it is used', () => {
    const fallback = resolveUserSpaceRuntimeFallback('/home/x/rox', 'darwin')
    expect(fallback.toolsDir).toBe('/home/x/rox/tools')
    expect(fallback.runtimeDir).toBe('/home/x/rox/tools/runtime')
    expect(fallback.binaryPath).toBe('/home/x/rox/tools/runtime/bin/bun')
    expect(fallback.description).toContain('/home/x/rox/tools/runtime/bin/bun')
  })

  it('uses a Windows binary name on win32', () => {
    expect(resolveUserSpaceRuntimeFallback('C:\\rox', 'win32').binaryPath.endsWith('bun.exe')).toBe(true)
  })
})

describe('probeRuntimeCapabilities — real success path', () => {
  it('runs a real SQLite WAL write in a temp dir under <state> and reports supported', () => {
    withConfigDir(configDir => {
      const openedPaths: string[] = []
      const report = probeRuntimeCapabilities({
        configDir,
        openDatabase: path => {
          openedPaths.push(path)
          return new DatabaseSync(path) as unknown as ProbeDatabase
        },
        readVersions: () => SAFE_VERSIONS,
      })

      expect(report.ok).toBe(true)
      expect(report.downgrade).toBeNull()
      expect(report.checks.map(check => check.id)).toEqual([
        'sqlite-version-floor',
        'sqlite-wal-write',
        'sqlite-nul-roundtrip',
      ])
      expect(report.checks.every(check => check.ok)).toBe(true)

      // The WAL write ran against a real file inside <state>/tmp, never /tmp.
      const scratchDir = join(configDir, 'tmp')
      const fileDbPaths = openedPaths.filter(path => path !== ':memory:')
      expect(fileDbPaths.length).toBe(1)
      expect(fileDbPaths[0]!.startsWith(scratchDir)).toBe(true)
      // The scratch directory exists (created under <state>) and is empty again.
      expect(readdirSync(scratchDir)).toEqual([])
    })
  })

  it('reports the versions it actually observed on this machine', () => {
    withConfigDir(configDir => {
      const report = probeRuntimeCapabilities({ configDir })
      expect(report.versions.runtimeVersion.length).toBeGreaterThan(0)
      expect(report.versions.sqliteVersion).toMatch(/^\d+\.\d+\.\d+/)
    })
  })
})

describe('probeRuntimeCapabilities — simulated failure paths', () => {
  it('returns a typed downgrade when the driver cannot put the DB into WAL mode', () => {
    withConfigDir(configDir => {
      const fake: ProbeDatabase = {
        exec: () => {},
        prepare: sql => ({
          get: () => (sql.includes('journal_mode') ? { journal_mode: 'delete' } : undefined),
          run: () => ({}),
        }),
        close: () => {},
      }
      const report = probeRuntimeCapabilities({
        configDir,
        openDatabase: () => fake,
        readVersions: () => SAFE_VERSIONS,
      })

      expect(report.ok).toBe(false)
      expect(report.downgrade).not.toBeNull()
      expect(report.downgrade!.reason).toBe('runtime-capability-unsupported')
      expect(report.downgrade!.failedChecks).toContain('sqlite-wal-write')
      expect(report.downgrade!.fallback.toolsDir).toBe(join(configDir, 'tools'))
      expect(report.downgrade!.fallback.binaryPath).toBe(join(configDir, 'tools', 'runtime', 'bin', 'bun'))
    })
  })

  it('returns a typed downgrade when the driver itself throws', () => {
    withConfigDir(configDir => {
      const report = probeRuntimeCapabilities({
        configDir,
        openDatabase: () => {
          throw new Error('no sqlite driver')
        },
      })

      expect(report.ok).toBe(false)
      expect(report.downgrade!.failedChecks).toEqual([
        'sqlite-version-floor',
        'sqlite-wal-write',
        'sqlite-nul-roundtrip',
      ])
      expect(report.versions.sqliteVersion).toBeNull()
      expect(report.checks.find(check => check.id === 'sqlite-wal-write')!.detail).toContain('no sqlite driver')
      // The only write stays under <state>: the scratch dir exists but no probe
      // subdirectory is left behind.
      expect(readdirSync(join(configDir, 'tmp'))).toEqual([])
    })
  })

  it('fails the version floor for a below-floor SQLite even when WAL writes work', () => {
    withConfigDir(configDir => {
      const report = probeRuntimeCapabilities({
        configDir,
        openDatabase: path => new DatabaseSync(path) as unknown as ProbeDatabase,
        readVersions: () => ({ ...SAFE_VERSIONS, sqliteVersion: '3.44.5' }),
      })
      expect(report.ok).toBe(false)
      expect(report.downgrade!.failedChecks).toEqual(['sqlite-version-floor'])
    })
  })
})