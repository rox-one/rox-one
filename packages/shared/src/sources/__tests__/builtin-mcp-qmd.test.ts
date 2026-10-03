import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_QMD_PACKAGE, ensureBuiltinQmdCollection } from '../builtin-mcp-qmd.ts';
import type { FolderSourceConfig } from '../types.ts';

describe('isolated QMD collection provisioning', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rox-qmd-config-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function config(): FolderSourceConfig {
    return {
      id: 'builtin-mcp-qmd', slug: 'qmd', name: 'QMD', enabled: true, provider: 'qmd', type: 'mcp',
      mcp: {
        transport: 'stdio', command: 'npx', args: ['-y', BUILTIN_QMD_PACKAGE, 'mcp', '--index', 'rox'], authType: 'none',
        env: { QMD_CONFIG_DIR: '${SOURCE_DIR}/config', XDG_CACHE_HOME: '${SOURCE_DIR}/cache' },
        platform: { win32: { command: 'npx.cmd' } },
      },
    };
  }
  function writeNotes(path: string, enabled = true): void {
    mkdirSync(join(root, 'sources', 'notes'), { recursive: true });
    writeFileSync(join(root, 'sources', 'notes', 'config.json'), JSON.stringify({ id: 'notes', slug: 'notes', name: 'Notes', provider: 'craft-notes', enabled, type: 'local', local: { path } }));
  }

  it('creates a usable empty Markdown collection without scanning the workspace root', () => {
    mkdirSync(join(root, 'sessions'), { recursive: true });
    writeFileSync(join(root, 'sessions', 'private-history.md'), 'Do not index this session');
    const result = ensureBuiltinQmdCollection(root, config());
    expect(result).toMatchObject({ created: true, canUpdate: true, collectionPath: join(root, 'sources', 'qmd', 'documents') });
    const document = parseYaml(readFileSync(result.configPath!, 'utf-8'));
    expect(document.collections.documents.path).toBe(result.collectionPath);
    expect(document.collections.documents.pattern).toBe('**/*.md');
    expect(document.collections.documents.update).toBeUndefined();
    expect(Object.keys(document.collections)).toEqual(['documents']);
    expect(existsSync(join(root, 'sources', 'qmd', 'cache'))).toBe(true);
    expect(existsSync(join(root, 'sources', 'qmd', 'cache', 'qmd', 'models'))).toBe(false);
    expect(ensureBuiltinQmdCollection(root, config())).toMatchObject({ created: false, canUpdate: true });
  });

  it('uses only the enabled existing Notes vault and resolves its portable path', () => {
    const notesPath = join(root, 'rox', 'notes');
    mkdirSync(notesPath, { recursive: true });
    writeFileSync(join(notesPath, 'daily.md'), '# A workspace note');
    writeNotes('${WORKSPACE}/rox/notes');
    const result = ensureBuiltinQmdCollection(root, config());
    expect(result.collectionPath).toBe(notesPath);
    const document = parseYaml(readFileSync(result.configPath!, 'utf-8'));
    expect(Object.keys(document.collections)).toEqual(['notes']);
    expect(document.collections.notes.path).toBe(notesPath);
    expect(existsSync(join(root, 'sources', 'qmd', 'documents'))).toBe(false);
  });

  it('respects a disabled Notes source by using the explicit documents collection', () => {
    const notesPath = join(root, 'notes');
    mkdirSync(notesPath);
    writeNotes(notesPath, false);
    expect(ensureBuiltinQmdCollection(root, config()).collectionPath).toBe(join(root, 'sources', 'qmd', 'documents'));
  });

  it('does not mutate disabled, non-owned or customized QMD runtime configurations', () => {
    const variants = [
      { ...config(), enabled: false },
      { ...config(), id: 'user-qmd' },
      { ...config(), mcp: { ...config().mcp, command: 'custom-qmd' } },
      { ...config(), mcp: { ...config().mcp, args: ['-y', BUILTIN_QMD_PACKAGE, 'mcp', '--index', 'custom'] } },
      { ...config(), mcp: { ...config().mcp, env: { QMD_CONFIG_DIR: '/custom/config', XDG_CACHE_HOME: '${SOURCE_DIR}/cache' } } },
      { ...config(), mcp: { ...config().mcp, env: { ...config().mcp?.env, INDEX_PATH: '/custom/index.sqlite' } } },
      { ...config(), mcp: { ...config().mcp, platform: { win32: { command: 'custom-launcher' } } } },
    ];
    for (const variant of variants) {
      const before = JSON.stringify(variant);
      expect(ensureBuiltinQmdCollection(root, variant)).toEqual({ created: false, canUpdate: false });
      expect(JSON.stringify(variant)).toBe(before);
    }
    expect(existsSync(join(root, 'sources', 'qmd'))).toBe(false);
  });

  it('preserves existing user YAML and prevents startup from running shell hooks', () => {
    const result = ensureBuiltinQmdCollection(root, config());
    const edited = 'collections:\n  custom:\n    path: /custom/docs\n    pattern: "**/*.md"\n    update: "echo user-command"\n';
    writeFileSync(result.configPath!, edited);
    expect(ensureBuiltinQmdCollection(root, config())).toMatchObject({ created: false, canUpdate: false });
    expect(readFileSync(result.configPath!, 'utf-8')).toBe(edited);
    const noHooks = 'collections:\n  custom:\n    path: /custom/docs\n    pattern: "**/*.md"\n';
    writeFileSync(result.configPath!, noHooks);
    expect(ensureBuiltinQmdCollection(root, config())).toMatchObject({ created: false, canUpdate: true });
    expect(readFileSync(result.configPath!, 'utf-8')).toBe(noHooks);
    writeFileSync(result.configPath!, 'collections: [invalid');
    expect(ensureBuiltinQmdCollection(root, config())).toMatchObject({ created: false, canUpdate: false });
  });
});
