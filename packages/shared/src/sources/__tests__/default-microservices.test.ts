import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectDefaultEnabledSourceSlugs,
  ensureDefaultMicroserviceSources,
  DEFAULT_ENABLED_SOURCE_SLUGS,
  resolveNativeFolderSourcePaths,
} from '../default-microservices.ts';
import { ensureRoxLayout } from '../../workspaces/rox-layout.ts';
import { loadSourceConfig } from '../storage.ts';

describe('default microservice sources', () => {
  let workspace: string;
  let home: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'ms-ws-'));
    home = mkdtempSync(join(tmpdir(), 'ms-home-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('lists local microservices plus MCP docs as session defaults', () => {
    expect(collectDefaultEnabledSourceSlugs()).toEqual([...DEFAULT_ENABLED_SOURCE_SLUGS]);
    expect(DEFAULT_ENABLED_SOURCE_SLUGS).toContain('notes');
    expect(DEFAULT_ENABLED_SOURCE_SLUGS).toContain('craft-agents-docs');
    expect(DEFAULT_ENABLED_SOURCE_SLUGS).toContain('exa');
  });

  it('seeds enabled local folder sources without inventing importers', () => {
    const layout = ensureRoxLayout({ homeDir: home, workspaceRoot: workspace });
    const created = ensureDefaultMicroserviceSources(workspace, {
      roxRoot: layout.root,
      notesPath: join(layout.root, 'notes'),
    });
    expect(created.created.sort()).toEqual([
      'applications',
      'memory',
      'projects',
      'sessions',
      'tasks',
      'telegram-support',
      'workspace-tree',
    ]);
    expect(existsSync(join(workspace, 'sources', 'notes', 'config.json'))).toBe(true);
    const memory = JSON.parse(readFileSync(join(workspace, 'sources', 'memory', 'config.json'), 'utf-8'));
    expect(memory.enabled).toBe(true);
    expect(memory.type).toBe('local');
    expect(existsSync(join(workspace, 'sources', 'browser-data'))).toBe(false);
    expect(existsSync(join(workspace, 'sources', 'running-apps'))).toBe(false);
  });

  it('does not overwrite an existing disabled source', () => {
    const layout = ensureRoxLayout({ homeDir: home, workspaceRoot: workspace });
    const dir = join(workspace, 'sources', 'memory');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ slug: 'memory', enabled: false }), 'utf-8');
    ensureDefaultMicroserviceSources(workspace, {
      roxRoot: layout.root,
      notesPath: join(layout.root, 'notes'),
    });
    const again = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8'));
    expect(again.enabled).toBe(false);
  });

  it('uses Windows app-data paths, including redirected APPDATA and a home fallback', () => {
    expect(resolveNativeFolderSourcePaths('win32', 'C:\\Users\\Alice', { APPDATA: 'D:\\Profile Data' })).toEqual({
      applications: 'D:\\Profile Data\\Microsoft\\Windows\\Start Menu\\Programs',
      telegram: 'D:\\Profile Data\\Telegram Desktop',
    });
    expect(resolveNativeFolderSourcePaths('win32', 'C:\\Users\\Alice', {})).toEqual({
      applications: 'C:\\Users\\Alice\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
      telegram: 'C:\\Users\\Alice\\AppData\\Roaming\\Telegram Desktop',
    });
  });

  it('uses macOS and Linux native locations without leaking Windows environment paths', () => {
    expect(resolveNativeFolderSourcePaths('darwin', '/Users/alice', { APPDATA: 'C:\\Profile' })).toEqual({
      applications: '/Users/alice/Applications',
      telegram: '/Users/alice/Library/Application Support/Telegram',
    });
    expect(resolveNativeFolderSourcePaths('linux', '/home/alice', { XDG_DATA_HOME: '/data/alice' })).toEqual({
      applications: '/data/alice/applications', telegram: '/data/alice/TelegramDesktop',
    });
    expect(resolveNativeFolderSourcePaths('linux', '/home/alice', {})).toEqual({
      applications: '/home/alice/.local/share/applications', telegram: '/home/alice/.local/share/TelegramDesktop',
    });
  });

  it('seeds native pointers for this platform and only marks existing folders connected', () => {
    ensureDefaultMicroserviceSources(workspace, { roxRoot: join(home, 'rox'), notesPath: join(home, 'notes') });
    const native = resolveNativeFolderSourcePaths();
    for (const [slug, path] of [['applications', native.applications], ['telegram-support', native.telegram]] as const) {
      const config = loadSourceConfig(workspace, slug);
      expect(config?.local?.path).toBe(path);
      expect(config?.enabled).toBe(true);
      expect(config?.connectionStatus).toBe(existsSync(path) ? 'connected' : 'untested');
    }
  });

  it('preserves existing native paths, status, enablement and guides on repeated seeding', () => {
    for (const slug of ['applications', 'telegram-support']) {
      const dir = join(workspace, 'sources', slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ slug, enabled: true, local: { path: 'custom-path' }, connectionStatus: 'failed' }));
      writeFileSync(join(dir, 'guide.md'), 'user guide');
    }
    ensureDefaultMicroserviceSources(workspace, { roxRoot: join(home, 'rox'), notesPath: join(home, 'notes') });
    for (const slug of ['applications', 'telegram-support']) {
      const dir = join(workspace, 'sources', slug);
      expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toEqual({ slug, enabled: true, local: { path: 'custom-path' }, connectionStatus: 'failed' });
      expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toBe('user guide');
    }
  });
});
