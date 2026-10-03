import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { join, win32, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { updateRegularSourceFile } from '../local-default-migration.ts';
import { ensureDefaultMicroserviceSources, migrateLegacyNativeDefault, resolveNativeFolderSourcePaths } from '../default-microservices.ts';
import { toPortablePath } from '../../utils/paths.ts';
import type { FolderSourceConfig } from '../types.ts';

describe('native folder source platform mapping', () => {
  test('resolves actual OS layout and refuses relative APPDATA/XDG overrides', () => {
    expect(resolveNativeFolderSourcePaths('win32', 'C:\\Users\\owner', { APPDATA: 'D:\\Profile\\Roaming' })).toEqual({
      applications: 'D:\\Profile\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs', telegram: 'D:\\Profile\\Roaming\\Telegram Desktop',
    });
    expect(resolveNativeFolderSourcePaths('win32', 'C:\\Users\\owner', { APPDATA: 'relative' }).telegram).toBe(win32.join('C:\\Users\\owner', 'AppData', 'Roaming', 'Telegram Desktop'));
    expect(resolveNativeFolderSourcePaths('darwin', '/Users/owner', {})).toEqual({ applications: '/Users/owner/Applications', telegram: '/Users/owner/Library/Application Support/Telegram' });
    expect(resolveNativeFolderSourcePaths('linux', '/home/owner', { XDG_DATA_HOME: '/data/owner' })).toEqual({ applications: '/data/owner/applications', telegram: '/data/owner/TelegramDesktop' });
    expect(resolveNativeFolderSourcePaths('linux', '/home/owner', { XDG_DATA_HOME: 'relative' }).telegram).toBe(posix.join('/home/owner', '.local', 'share', 'TelegramDesktop'));
  });
});

describe('actual temporary-file default migration and replacement refusal', () => {
  let root: string;
  let home: string;
  let configPath: string;
  let guidePath: string;
  let target: string;
  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'rox-local-migration-'));
    home = join(root, 'home'); target = join(root, 'native-target');
    fs.mkdirSync(home); fs.mkdirSync(target); fs.mkdirSync(join(root, 'sources', 'applications'), { recursive: true });
    configPath = join(root, 'sources', 'applications', 'config.json'); guidePath = join(root, 'sources', 'applications', 'guide.md');
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
  function legacy(overrides: Partial<FolderSourceConfig> = {}): FolderSourceConfig {
    return { id: 'ms-applications', slug: 'applications', name: 'Applications', icon: '🧩', tagline: 'Applications and ~/Library/Applications',
      enabled: false, provider: 'craft-local', type: 'local', local: { path: '~/Applications', format: 'markdown' },
      createdAt: 123, updatedAt: 456, connectionStatus: 'failed', connectionError: 'old missing path', ...overrides };
  }
  function oldGuide() { return `# Applications\n\nFolder source for installed apps. Paths (macOS):\n\n- ${join(home, 'Applications')}\n- /Applications\n- ~/Library/Applications\n\nThis is a folder pointer, not a live process enumerator.\n`; }
  function store(config = legacy(), guide = 'user-owned guide') { fs.writeFileSync(configPath, JSON.stringify(config)); fs.writeFileSync(guidePath, guide); }
  function migrate(platform: NodeJS.Platform = 'win32') {
    // The production migrator is exercised with actual POSIX temporary files;
    // OS path-selection itself is pure above. This is not native Windows proof.
    return migrateLegacyNativeDefault(root, configPath, {
      slug: 'applications', name: 'Applications', icon: '🧩', tagline: 'Native application folder and launch shortcuts',
      path: target, mkdir: false, guide: `Native folder\n${target}\n`,
    }, { platform, homeDir: home, env: {}, roxRoot: join(root, 'rox'), notesPath: join(root, 'notes') }, 1000);
  }

  test('moves only exact obsolete signature with real target and preserves disabled/custom guide/creation identity', () => {
    store();
    expect(migrate()).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.local).toEqual({ path: toPortablePath(target), format: 'markdown' });
    expect(config.enabled).toBe(false); expect(config.createdAt).toBe(123); expect(config.updatedAt).toBe(1000);
    expect(config.connectionStatus).toBe('connected'); expect(config.connectionError).toBeUndefined();
    expect(fs.readFileSync(guidePath, 'utf8')).toBe('user-owned guide');
    const once = fs.readFileSync(configPath, 'utf8');
    expect(migrate()).toBe(false); expect(fs.readFileSync(configPath, 'utf8')).toBe(once);
  });

  test('updates only exact generated guide and accepts exact expanded/backslash defaults', () => {
    for (const path of ['~\\Applications', join(home, 'Applications')]) {
      store(legacy({ local: { path, format: 'markdown' } }), oldGuide());
      expect(migrate()).toBe(true); expect(fs.readFileSync(guidePath, 'utf8')).toBe(`Native folder\n${target}\n`);
    }
  });

  test('refuses each customized identity, unsupported OS, malformed data and absent/file replacement', () => {
    for (const override of [{ id: 'custom' }, { provider: 'custom' }, { name: 'My apps' }, { icon: '📁' }, { tagline: 'my description' },
      { type: 'mcp' as const }, { local: { path: '~/custom', format: 'markdown' as const } }, { local: { path: '~/Applications', format: 'json' as const } }]) {
      store(legacy(override)); const before = fs.readFileSync(configPath, 'utf8');
      expect(migrate()).toBe(false); expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
    }
    store(); const before = fs.readFileSync(configPath, 'utf8');
    for (const platform of ['darwin', 'linux'] as const) expect(migrate(platform)).toBe(false);
    fs.mkdirSync(join(home, 'Applications')); expect(migrate()).toBe(false);
    fs.rmdirSync(join(home, 'Applications')); fs.rmdirSync(target); expect(migrate()).toBe(false);
    fs.writeFileSync(target, 'not directory'); expect(migrate()).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
    fs.writeFileSync(configPath, '{broken'); expect(migrate()).toBe(false); expect(fs.readFileSync(configPath, 'utf8')).toBe('{broken');
  });

  test('admitted descriptor refuses in-place customization during transform', () => {
    store();
    expect(updateRegularSourceFile(configPath, root, () => { fs.writeFileSync(configPath, 'customized concurrently'); return 'obsolete migration'; })).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).toBe('customized concurrently');
  });

  test.skipIf(process.platform === 'win32')('refuses leaf link/hardlink/FIFO, oversized data and replacement during transform without outside writes', () => {
    const outside = join(root, 'outside'); fs.writeFileSync(outside, 'outside sentinel');
    fs.symlinkSync(outside, configPath); expect(migrate()).toBe(false); expect(fs.readFileSync(outside, 'utf8')).toBe('outside sentinel');
    fs.unlinkSync(configPath); fs.linkSync(outside, configPath); expect(migrate()).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe('outside sentinel'); fs.unlinkSync(configPath);
    execFileSync('/usr/bin/mkfifo', [configPath]); expect(migrate()).toBe(false); fs.unlinkSync(configPath);
    fs.writeFileSync(configPath, 'x'.repeat(256 * 1024 + 1)); expect(migrate()).toBe(false);
    store();
    expect(updateRegularSourceFile(configPath, root, () => { fs.renameSync(configPath, `${configPath}.old`); fs.symlinkSync(outside, configPath); return 'migration'; })).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe('outside sentinel');
    expect(fs.readFileSync(`${configPath}.old`, 'utf8')).toBe(JSON.stringify(legacy()));
  });

  test.skipIf(process.platform === 'win32')('refuses linked guide/source directory and linked sources root', () => {
    store(); fs.unlinkSync(guidePath); const outside = join(root, 'outside'); fs.writeFileSync(outside, oldGuide()); fs.symlinkSync(outside, guidePath);
    expect(migrate()).toBe(true); expect(fs.readFileSync(outside, 'utf8')).toBe(oldGuide());
    fs.renameSync(join(root, 'sources', 'applications'), join(root, 'moved-source'));
    fs.symlinkSync(join(root, 'moved-source'), join(root, 'sources', 'applications')); expect(migrate()).toBe(false);
    fs.unlinkSync(join(root, 'sources', 'applications')); fs.rmdirSync(join(root, 'sources'));
    const outsideSources = join(root, 'outside-sources'); fs.mkdirSync(outsideSources); fs.symlinkSync(outsideSources, join(root, 'sources'));
    expect(ensureDefaultMicroserviceSources(root, { roxRoot: join(root, 'rox'), notesPath: join(root, 'notes') }).created).toEqual([]);
    expect(fs.readdirSync(outsideSources)).toEqual([]);
  });

  test('fresh Linux defaults use live folder evidence and preserve user guide while seeding exclusively', () => {
    const userDir = join(root, 'sources', 'telegram-support'); fs.mkdirSync(userDir); fs.writeFileSync(join(userDir, 'guide.md'), 'my instructions');
    const data = join(home, '.local', 'share'); fs.mkdirSync(join(data, 'applications'), { recursive: true });
    const opts = { platform: 'linux' as const, homeDir: home, env: {}, roxRoot: join(root, 'rox'), notesPath: join(root, 'notes') };
    fs.rmSync(configPath, { force: true }); // Existing fixture folder, no persisted user config.
    expect(ensureDefaultMicroserviceSources(root, opts).created).toContain('applications');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).connectionStatus).toBe('connected');
    expect(JSON.parse(fs.readFileSync(join(userDir, 'config.json'), 'utf8')).connectionStatus).toBe('untested');
    expect(fs.readFileSync(join(userDir, 'guide.md'), 'utf8')).toBe('my instructions');
    expect(ensureDefaultMicroserviceSources(root, opts).created).toEqual([]);
  });
});
