import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** `appearance-defaults-v2-ink`: legacy defaults (incl. the v1 seed) move to Rox Ink once. */
const repo = join(import.meta.dir, '../../../../..')
const storageModule = pathToFileURL(join(import.meta.dir, '../storage.ts')).href
const pathsModule = pathToFileURL(join(import.meta.dir, '../../utils/paths.ts')).href
const seed = { enabled: true, deepGlass: { content: true, editor: true, lists: true } }

function migrate(config: Record<string, unknown>, appTheme?: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'rox-ink-migration-'))
  try {
    writeFileSync(join(dir, 'config-defaults.json'), readFileSync(join(repo, 'apps/electron/resources/config-defaults.json')))
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, llmConnections: [], ...config }))
    if (appTheme) writeFileSync(join(dir, 'theme.json'), JSON.stringify(appTheme))
    const result = Bun.spawnSync([process.execPath, '--eval', `
      import * as storage from ${JSON.stringify(storageModule)};
      import { setBundledAssetsRoot } from ${JSON.stringify(pathsModule)};
      setBundledAssetsRoot(${JSON.stringify(join(repo, 'apps/electron'))});
      storage.migrateLegacyLlmConnectionsConfig();
      const first = storage.loadStoredConfig();
      storage.migrateLegacyLlmConnectionsConfig();
      process.stdout.write(JSON.stringify({ theme: first.colorTheme, migrations: first.migrationsApplied ?? [], appTheme: storage.loadAppTheme() }));
    `], { cwd: dir, env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir, ROX_API_KEY: '' }, stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    return JSON.parse(result.stdout.toString()) as { theme: string; migrations: string[]; appTheme: Record<string, unknown> | null }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('appearance-defaults-v2-ink', () => {
  it('moves the v1 Rox Engineering seed to Rox Ink and drops the untouched deep-glass seed', () => {
    const r = migrate({ colorTheme: 'super-engineering', migrationsApplied: ['appearance-defaults-v1'] }, { accent: '#123456', material: seed })
    expect(r.theme).toBe('rox-ink')
    expect(r.appTheme).toEqual({ accent: '#123456' })
    expect(r.migrations).toContain('appearance-defaults-v2-ink')
  }, 30_000)

  it('keeps explicit non-legacy picks and edited material', () => {
    const edited = { enabled: true, deepGlass: { content: true, editor: false, lists: true } }
    const r = migrate({ colorTheme: 'siri-light', migrationsApplied: ['appearance-defaults-v1'] }, { material: edited })
    expect(r.theme).toBe('siri-light')
    expect(r.appTheme).toEqual({ material: edited })
  }, 30_000)

  it('does not seed deep glass on installs that never ran v1', () => {
    const r = migrate({ colorTheme: 'haze' })
    expect(r.theme).toBe('rox-ink')
    expect(r.appTheme).toBeNull()
    expect(r.migrations).toEqual(expect.arrayContaining(['appearance-defaults-v1', 'appearance-defaults-v2-ink']))
  }, 30_000)
})
