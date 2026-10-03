import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDefaultMicroserviceSources, resolveNativeFolderSourcePaths } from '../default-microservices.ts';
import type { FolderSourceConfig } from '../types.ts';
import { toPortablePath } from '../../utils/paths.ts';

// These are real Windows filesystem probes. Backslash paths on POSIX would
// become cwd-relative fixture directories rather than stay under the temp root.
describe.skipIf(process.platform !== 'win32')('legacy native default migration', () => {
  let root: string;
  let workspace: string;
  let home: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'native-migration-'));
    workspace = join(root, 'workspace');
    home = join(root, 'home');
    env = { APPDATA: join(root, 'redirected app data') };
    mkdirSync(workspace);
    mkdirSync(home);
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function legacy(slug: 'applications' | 'telegram-support'): FolderSourceConfig {
    return {
      id: `ms-${slug}`, slug, name: slug === 'applications' ? 'Applications' : 'Telegram Application Support',
      enabled: true, provider: 'craft-local', type: 'local',
      local: { path: slug === 'applications' ? '~/Applications' : '~/Library/Application Support/Telegram', format: 'markdown' },
      icon: slug === 'applications' ? '🧩' : '✈️',
      tagline: slug === 'applications' ? 'Applications and ~/Library/Applications' : 'Telegram Application Support folder',
      isAuthenticated: true, connectionStatus: 'failed', connectionError: 'old missing path',
      createdAt: 123, updatedAt: 456,
    };
  }
  function store(config: FolderSourceConfig, guide = 'custom guide kept verbatim'): string {
    const dir = join(workspace, 'sources', config.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'guide.md'), guide);
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(config));
    return file;
  }
  function seed(platform: NodeJS.Platform = 'win32') {
    return ensureDefaultMicroserviceSources(workspace, {
      roxRoot: join(root, 'rox'), notesPath: join(root, 'notes'), platform, homeDir: home, env,
    });
  }
  function target(slug: string): string {
    const paths = resolveNativeFolderSourcePaths('win32', home, env);
    return slug === 'applications' ? paths.applications : paths.telegram;
  }

  for (const slug of ['applications', 'telegram-support'] as const) {
    it(`migrates ${slug} only with folder evidence and preserves disabled preference`, () => {
      const original = { ...legacy(slug), enabled: false };
      const file = store(original);
      mkdirSync(target(slug), { recursive: true });
      expect(seed().created).not.toContain(slug);
      const migrated = JSON.parse(readFileSync(file, 'utf8'));
      expect(migrated.local.path).toBe(toPortablePath(target(slug)));
      expect(migrated.local.format).toBe('markdown');
      expect(migrated.enabled).toBe(false);
      expect(migrated.connectionStatus).toBe('connected');
      expect(migrated.connectionError).toBeUndefined();
      expect(migrated.createdAt).toBe(123);
      expect(migrated.updatedAt).toBeGreaterThan(456);
      expect(readFileSync(join(workspace, 'sources', slug, 'guide.md'), 'utf8')).toBe('custom guide kept verbatim');
      const once = readFileSync(file, 'utf8');
      seed();
      expect(readFileSync(file, 'utf8')).toBe(once);
    });

    it(`leaves ${slug} and health untouched without a verified new directory`, () => {
      const file = store(legacy(slug));
      const before = readFileSync(file, 'utf8');
      seed();
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(existsSync(target(slug))).toBe(false);
      mkdirSync(join(target(slug), '..'), { recursive: true });
      writeFileSync(target(slug), 'file, not folder');
      seed();
      expect(readFileSync(file, 'utf8')).toBe(before);
    });

    it(`preserves an existing legacy ${slug} path`, () => {
      const config = legacy(slug);
      const oldPath = join(home, config.local!.path.slice(2));
      mkdirSync(oldPath, { recursive: true });
      mkdirSync(target(slug), { recursive: true });
      const file = store(config);
      const before = readFileSync(file, 'utf8');
      seed();
      expect(readFileSync(file, 'utf8')).toBe(before);
    });

    it(`accepts exact old Windows portable and expanded ${slug} defaults`, () => {
      mkdirSync(target(slug), { recursive: true });
      for (const path of [legacy(slug).local!.path.replaceAll('/', '\\'), join(home, legacy(slug).local!.path.slice(2))]) {
        const file = store({ ...legacy(slug), local: { path, format: 'markdown' } });
        seed();
        expect(JSON.parse(readFileSync(file, 'utf8')).local.path).toBe(toPortablePath(target(slug)));
      }
    });

    it(`never migrates customized ${slug} identity or paths`, () => {
      mkdirSync(target(slug), { recursive: true });
      for (const override of [
        { id: 'user-source' }, { provider: 'custom' }, { name: 'My folder' },
        { tagline: 'My custom description' }, { icon: '📁' },
        { local: { path: '~/custom-data', format: 'markdown' as const } },
        { local: { path: legacy(slug).local!.path, format: 'json' as const } },
        { type: 'mcp' as const },
      ]) {
        const file = store({ ...legacy(slug), ...override });
        const before = readFileSync(file, 'utf8');
        seed();
        expect(readFileSync(file, 'utf8')).toBe(before);
      }
    });

    for (const platform of ['darwin', 'linux'] as const) {
      it(`does not migrate ${slug} on ${platform}`, () => {
        mkdirSync(target(slug), { recursive: true });
        const file = store(legacy(slug));
        const before = readFileSync(file, 'utf8');
        seed(platform);
        expect(readFileSync(file, 'utf8')).toBe(before);
      });
    }
  }

  it('replaces only the exact auto-generated legacy guide', () => {
    const oldPath = join(home, 'Library', 'Application Support', 'Telegram');
    store(legacy('telegram-support'), `# Telegram Application Support\n\nFolder source for:\n\n${oldPath}\n\nThis is a folder pointer, not a Telegram API importer.\n`);
    mkdirSync(target('telegram-support'), { recursive: true });
    seed();
    const guide = readFileSync(join(workspace, 'sources', 'telegram-support', 'guide.md'), 'utf8');
    expect(guide).toContain('Native folder (win32)');
    expect(guide).toContain(target('telegram-support'));
    expect(guide).not.toContain(oldPath);
  });

  it('uses fallback Windows paths and does not mark a file as a healthy native source', () => {
    env = {};
    const file = store(legacy('applications'));
    mkdirSync(target('applications'), { recursive: true });
    // Fresh seeding also requires an actual readable directory for health.
    mkdirSync(join(target('telegram-support'), '..'), { recursive: true });
    writeFileSync(target('telegram-support'), 'not a folder');
    seed();
    expect(JSON.parse(readFileSync(file, 'utf8')).local.path).toBe(toPortablePath(target('applications')));
    const telegram = JSON.parse(readFileSync(join(workspace, 'sources', 'telegram-support', 'config.json'), 'utf8'));
    expect(telegram.connectionStatus).toBe('untested');
  });
});
