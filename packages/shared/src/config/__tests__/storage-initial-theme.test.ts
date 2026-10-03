import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = join(import.meta.dir, '../../../../..')
const storageModule = pathToFileURL(join(import.meta.dir, '../storage.ts')).href
const pathsModule = pathToFileURL(join(import.meta.dir, '../../utils/paths.ts')).href
const legacyModule = pathToFileURL(join(import.meta.dir, '../legacy-config-migration.ts')).href
const registry = { workspaces: [], activeWorkspaceId: null, activeSessionId: null }

function isolated<T>(initialContents: string | undefined, operation: string, setup?: (dir: string) => void): T {
  const dir = mkdtempSync(join(tmpdir(), 'rox-initial-theme-'))
  try {
    writeFileSync(join(dir, 'config-defaults.json'), readFileSync(join(repo, 'apps/electron/resources/config-defaults.json')))
    if (initialContents !== undefined) writeFileSync(join(dir, 'config.json'), initialContents)
    setup?.(dir)
    const result = Bun.spawnSync([process.execPath, '--eval', `
      import * as storage from ${JSON.stringify(storageModule)};
      import { setBundledAssetsRoot } from ${JSON.stringify(pathsModule)};
      setBundledAssetsRoot(${JSON.stringify(join(repo, 'apps/electron'))});
      ${operation}
    `], {
      cwd: dir,
      env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir, ROX_API_KEY: '' },
      stdout: 'pipe', stderr: 'pipe',
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    return JSON.parse(result.stdout.toString())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('new-install theme selection', () => {
  it('seeds Nordfox for a physically missing config and retains it after reload', () => {
    const result = isolated<{ before: string; after: string; stored: string }>(undefined, `
      const before = storage.getColorTheme();
      await storage.seedDefaultLlmConnection();
      process.stdout.write(JSON.stringify({ before, after: storage.getColorTheme(), stored: storage.loadStoredConfig().colorTheme }));
    `)
    expect(result).toEqual({ before: 'haze', after: 'nordfox-opaque', stored: 'nordfox-opaque' })
  }, 30_000)

  for (const colorTheme of [undefined, 'default', 'custom-user-theme', 'siri-light']) {
    it(`preserves an existing registry with ${colorTheme ?? 'no explicit preference'}`, () => {
      const result = isolated<{ selected: string; hasPreference: boolean }>(JSON.stringify({ ...registry, ...(colorTheme ? { colorTheme } : {}) }), `
        await storage.seedDefaultLlmConnection();
        const config = storage.loadStoredConfig();
        process.stdout.write(JSON.stringify({ selected: storage.getColorTheme(), hasPreference: Object.hasOwn(config, 'colorTheme') }));
      `)
      expect(result).toEqual({ selected: colorTheme ?? 'haze', hasPreference: colorTheme !== undefined })
    }, 30_000)
  }

  it('leaves a corrupt existing registry byte-for-byte intact', () => {
    const corrupt = '{ existing imported configuration'
    const result = isolated<{ contents: string }>(corrupt, `
      import { readFileSync } from 'node:fs';
      await storage.seedDefaultLlmConnection();
      process.stdout.write(JSON.stringify({ contents: readFileSync(storage.getConfigPath(), 'utf8') }));
    `)
    expect(result.contents).toBe(corrupt)
  }, 30_000)

  it('preserves an imported legacy registry without treating the destination as a new install', () => {
    const imported = JSON.stringify(registry)
    const result = isolated<{ selected: string; hasPreference: boolean; original: string }>(undefined, `
      import { readFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { importLegacyConfig } from ${JSON.stringify(legacyModule)};
      const home = join(process.env.ROX_CONFIG_DIR, 'legacy-home');
      importLegacyConfig(home, process.env.ROX_CONFIG_DIR);
      await storage.seedDefaultLlmConnection();
      process.stdout.write(JSON.stringify({
        selected: storage.getColorTheme(),
        hasPreference: Object.hasOwn(storage.loadStoredConfig(), 'colorTheme'),
        original: readFileSync(join(home, '.craft-agent/config.json'), 'utf8'),
      }));
    `, dir => {
      mkdirSync(join(dir, 'legacy-home/.craft-agent'), { recursive: true })
      writeFileSync(join(dir, 'legacy-home/.craft-agent/config.json'), imported)
    })
    expect(result).toEqual({ selected: 'haze', hasPreference: false, original: imported })
  }, 30_000)

  it('sets the fresh default when the first workspace creates the registry', () => {
    const result = isolated<{ selected: string; workspaceCount: number }>(undefined, `
      import { join } from 'node:path';
      storage.addWorkspace({ name: 'Theme fixture', rootPath: join(process.env.ROX_CONFIG_DIR, 'workspaces/fixture') });
      process.stdout.write(JSON.stringify({ selected: storage.getColorTheme(), workspaceCount: storage.loadStoredConfig().workspaces.length }));
    `)
    expect(result).toEqual({ selected: 'nordfox-opaque', workspaceCount: 1 })
  }, 30_000)

  it('saves and reads back existing custom theme ids with spaces, dots and Unicode', () => {
    const selected = 'Моя тема.v2'
    const result = isolated<{ selected: string; stored: string }>(JSON.stringify(registry), `
      storage.setColorTheme(${JSON.stringify(selected)});
      process.stdout.write(JSON.stringify({ selected: storage.getColorTheme(), stored: storage.loadStoredConfig().colorTheme }));
    `)
    expect(result).toEqual({ selected, stored: selected })
  }, 30_000)

  for (const initial of [undefined, '{ unreadable registry', JSON.stringify({ unrelated: true })]) {
    it(`rejects a theme write with ${initial === undefined ? 'missing' : 'unreadable'} config without creating or replacing it`, () => {
      const result = isolated<{ rejected: boolean; contents: string | null }>(initial, `
        import { existsSync, readFileSync } from 'node:fs';
        let rejected = false;
        try { storage.setColorTheme('siri-light'); } catch { rejected = true; }
        process.stdout.write(JSON.stringify({ rejected, contents: existsSync(storage.getConfigPath()) ? readFileSync(storage.getConfigPath(), 'utf8') : null }));
      `)
      expect(result).toEqual({ rejected: true, contents: initial ?? null })
    }, 30_000)
  }

  it('rejects unsafe ids before replacing an existing selected theme', () => {
    const initial = JSON.stringify({ ...registry, colorTheme: 'custom-user-theme' })
    const result = isolated<{ rejected: number; contents: string; selected: string }>(initial, `
      import { readFileSync } from 'node:fs';
      let rejected = 0;
      for (const id of ['', '.', '..', '../config', 'a/b', 'a\\\\b', 'a\\0b']) {
        try { storage.setColorTheme(id); } catch { rejected += 1; }
      }
      process.stdout.write(JSON.stringify({ rejected, contents: readFileSync(storage.getConfigPath(), 'utf8'), selected: storage.getColorTheme() }));
    `)
    expect(result).toEqual({ rejected: 7, contents: initial, selected: 'custom-user-theme' })
  }, 30_000)

  it('seeds all three new presets and preserves user customizations and override files', () => {
    const customized = JSON.stringify({ name: 'Customized Nordfox', background: '#121212', terminalAnsi: { red: '#dd0000' }, dark: { titlebar: '#171717' } })
    const override = JSON.stringify({ accent: '#abcdef' })
    const result = isolated<{ ids: string[]; customized: string; override: string }>(JSON.stringify({ ...registry, colorTheme: 'custom-user-theme' }), `
      import { readFileSync } from 'node:fs';
      import { join } from 'node:path';
      const presets = storage.loadPresetThemes();
      process.stdout.write(JSON.stringify({
        ids: presets.map(preset => preset.id),
        customized: readFileSync(join(storage.getAppThemesDir(), 'nordfox-opaque.json'), 'utf8'),
        override: readFileSync(join(process.env.ROX_CONFIG_DIR, 'theme.json'), 'utf8'),
      }));
    `, dir => {
      mkdirSync(join(dir, 'themes'))
      writeFileSync(join(dir, 'themes/nordfox-opaque.json'), customized)
      writeFileSync(join(dir, 'theme.json'), override)
    })
    expect(result.ids).toContain('nordfox-opaque')
    expect(result.ids).toContain('min-dark-blurred')
    expect(result.ids).toContain('siri-light')
    expect(result.customized).toBe(customized)
    expect(result.override).toBe(override)
  }, 30_000)
})
