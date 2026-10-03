import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureBuiltinSources,
  isBuiltinSource,
  getBuiltinSources,
  getDocsSource,
  getBuiltinSourceCredential,
} from '../builtin-sources.ts';
import { computeSourceTokenStats } from '../source-stats.ts';
import { getSourcesBySlugs, isSourceUsable, loadSource, loadWorkspaceSources, markSourceAuthenticated, saveSourceConfig } from '../storage.ts';
import { sourceNeedsAuthentication } from '../credential-manager.ts';
import { SERVER_SERVICE_KEYS } from '../../config/server-services.ts';

describe('builtin sources seed', () => {
  let dir: string;
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'craft-builtin-src-'));
    const names = [...SERVER_SERVICE_KEYS, 'ROX_SERVICE_SECRETS_FILE', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY', 'CRAFT_FIRECRAWL_API_KEY', 'ROX_FIRECRAWL_API_KEY', 'ROX_BRAVE_API_KEY', 'ROX_E2B_API_KEY'];
    previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    process.env.ROX_SERVICE_SECRETS_FILE = join(dir, 'nonexistent.env');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('recognizes exa and firecrawl slugs as builtin', () => {
    expect(isBuiltinSource('exa')).toBe(true);
    expect(isBuiltinSource('firecrawl')).toBe(true);
    expect(isBuiltinSource('brave')).toBe(true);
    expect(isBuiltinSource('e2b')).toBe(true);
    expect(isBuiltinSource('craft-agents-docs')).toBe(true);
    expect(isBuiltinSource('linear')).toBe(false);
  });

  it('creates enabled API source templates once', () => {
    const first = ensureBuiltinSources(dir);
    expect(first.created.sort()).toEqual(['brave', 'e2b', 'exa', 'firecrawl']);
    expect(existsSync(join(dir, 'sources', 'exa', 'config.json'))).toBe(true);
    expect(existsSync(join(dir, 'sources', 'firecrawl', 'guide.md'))).toBe(true);

    const cfg = JSON.parse(readFileSync(join(dir, 'sources', 'exa', 'config.json'), 'utf-8'));
    expect(cfg.slug).toBe('exa');
    expect(cfg.type).toBe('api');
    expect(cfg.enabled).toBe(true);

    const second = ensureBuiltinSources(dir);
    expect(second.created).toEqual([]);
  });

  it('does not overwrite user-edited config', () => {
    ensureBuiltinSources(dir);
    const path = join(dir, 'sources', 'exa', 'config.json');
    const edited = JSON.parse(readFileSync(path, 'utf-8'));
    edited.name = 'My Exa';
    writeFileSync(path, JSON.stringify(edited, null, 2));
    ensureBuiltinSources(dir);
    const again = JSON.parse(readFileSync(path, 'utf-8'));
    expect(again.name).toBe('My Exa');
  });

  it('enables the docs MCP placeholder by default', () => {
    const docs = getDocsSource('ws', dir);
    expect(docs.config.enabled).toBe(true);
    expect(docs.config.type).toBe('mcp');
  });

  it('computeSourceTokenStats uses guide for api builtins', () => {
    const [exa] = getBuiltinSources('ws', dir);
    const stats = computeSourceTokenStats(exa!);
    expect(stats.source).toBe('guide');
    expect(stats.tokenEstimate).toBeGreaterThan(0);
  });

  it('makes previously unconfigured providers usable when private backend credentials arrive', () => {
    ensureBuiltinSources(dir);
    const before = loadWorkspaceSources(dir);
    expect(before.every((source) => !isSourceUsable(source))).toBe(true);
    const secrets = join(dir, 'private.env');
    writeFileSync(secrets, 'EXA_API_KEY=fixture-exa\nFIRECRAWL_API_KEY=fixture-firecrawl\nBRAVE_API_KEY=fixture-brave\nE2B_API_KEY=fixture-e2b\n', { mode: 0o600 });
    process.env.ROX_SERVICE_SECRETS_FILE = secrets;
    const sources = getSourcesBySlugs(dir, ['exa', 'firecrawl', 'brave', 'e2b']);
    expect(sources).toHaveLength(4);
    for (const source of sources) {
      expect(isSourceUsable(source)).toBe(true);
      expect(sourceNeedsAuthentication(source)).toBe(false);
      expect(source.config.connectionStatus).toBe('connected');
      expect(JSON.stringify(source)).not.toContain('fixture-');
      const disk = readFileSync(join(source.folderPath, 'config.json'), 'utf8');
      expect(disk).not.toContain('fixture-');
      expect(JSON.parse(disk).isAuthenticated).toBe(false);
    }
  });

  it('migrates unchanged legacy defaults once and preserves later explicit disablement', () => {
    ensureBuiltinSources(dir);
    const path = join(dir, 'sources', 'exa', 'config.json');
    const marker = join(dir, 'sources', '.default-services-v1-exa');
    rmSync(marker);
    const config = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...config, enabled: false }));
    expect(ensureBuiltinSources(dir).defaulted).toEqual(['exa']);
    expect(loadSource(dir, 'exa')?.config.enabled).toBe(true);
    writeFileSync(path, JSON.stringify({ ...config, enabled: false, updatedAt: config.createdAt + 1 }));
    expect(ensureBuiltinSources(dir).defaulted).toEqual([]);
    expect(loadSource(dir, 'exa')?.config.enabled).toBe(false);
  });

  it('preserves an edited legacy source and does not route shared credentials to a changed origin', () => {
    ensureBuiltinSources(dir);
    const path = join(dir, 'sources', 'exa', 'config.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    rmSync(join(dir, 'sources', '.default-services-v1-exa'));
    writeFileSync(path, JSON.stringify({ ...config, enabled: false, updatedAt: config.createdAt + 1 }));
    expect(ensureBuiltinSources(dir).defaulted).toEqual([]);
    process.env.EXA_API_KEY = 'fixture-exa';
    const source = loadSource(dir, 'exa')!;
    expect(isSourceUsable(source)).toBe(false);
    expect(getBuiltinSourceCredential(source)).toBe('fixture-exa');
    source.config.api!.baseUrl = 'https://other.example';
    expect(getBuiltinSourceCredential(source)).toBeUndefined();
    source.config.api!.baseUrl = config.api.baseUrl;
    source.config.api!.headerName = 'different-header';
    expect(getBuiltinSourceCredential(source)).toBeUndefined();
    source.config.api!.headerName = config.api.headerName;
    source.config.id = 'user-configured-exa';
    expect(getBuiltinSourceCredential(source)).toBeUndefined();
  });

  it('keeps real upstream failure visible after credential provisioning', () => {
    ensureBuiltinSources(dir);
    const path = join(dir, 'sources', 'exa', 'config.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...config, connectionStatus: 'failed', connectionError: 'Quota exhausted' }));
    process.env.EXA_API_KEY = 'fixture-exa';
    expect(loadSource(dir, 'exa')?.config.connectionStatus).toBe('failed');
    expect(loadSource(dir, 'exa')?.config.connectionError).toBe('Quota exhausted');
  });

  it('removes the connected badge when a provisioned shared key is withdrawn', () => {
    process.env.EXA_API_KEY = 'fixture-exa';
    ensureBuiltinSources(dir);
    expect(loadSource(dir, 'exa')?.config.connectionStatus).toBe('connected');
    delete process.env.EXA_API_KEY;
    const source = loadSource(dir, 'exa')!;
    expect(source.config.connectionStatus).toBe('needs_auth');
    expect(isSourceUsable(source)).toBe(false);
  });

  it('does not persist shared authentication through rename, toggle or a serialized source update', () => {
    ensureBuiltinSources(dir);
    process.env.EXA_API_KEY = 'fixture-shared';
    const projected = loadSource(dir, 'exa')!;
    expect(projected.config).toMatchObject({ isAuthenticated: true });
    const updated = JSON.parse(JSON.stringify(projected.config));
    saveSourceConfig(dir, { ...updated, name: 'Renamed research', enabled: false });
    const stored = JSON.parse(readFileSync(join(dir, 'sources', 'exa', 'config.json'), 'utf8'));
    expect(stored.isAuthenticated).toBe(false);
    expect(stored.connectionStatus).toBe('needs_auth');
    expect(stored.builtinCredentialProjection).toBeUndefined();
    saveSourceConfig(dir, { ...loadSource(dir, 'exa')!.config, enabled: true });
    delete process.env.EXA_API_KEY;
    const reloaded = loadSource(dir, 'exa')!;
    expect(reloaded.config.name).toBe('Renamed research');
    expect(reloaded.config.connectionStatus).toBe('needs_auth');
    expect(reloaded.config).toMatchObject({ isAuthenticated: false });
    expect(isSourceUsable(reloaded)).toBe(false);
    // A session holding the previously loaded object cannot keep stale availability.
    expect(isSourceUsable(projected)).toBe(false);
  });

  it('preserves user authentication established while a shared credential is available', () => {
    ensureBuiltinSources(dir);
    process.env.EXA_API_KEY = 'fixture-shared';
    expect(markSourceAuthenticated(dir, 'exa')).toBe(true);
    saveSourceConfig(dir, { ...loadSource(dir, 'exa')!.config, name: 'Personal Exa' });
    delete process.env.EXA_API_KEY;
    const source = loadSource(dir, 'exa')!;
    expect(source.config).toMatchObject({ isAuthenticated: true });
    expect(source.config.connectionStatus).toBe('connected');
    expect(isSourceUsable(source)).toBe(true);
  });

  it('restores a failed user state after shared availability without losing its diagnostic', () => {
    ensureBuiltinSources(dir);
    process.env.EXA_API_KEY = 'fixture-shared';
    const source = loadSource(dir, 'exa')!;
    saveSourceConfig(dir, { ...source.config, connectionStatus: 'failed', connectionError: 'Provider quota exhausted' });
    delete process.env.EXA_API_KEY;
    const reloaded = loadSource(dir, 'exa')!;
    expect(reloaded.config).toMatchObject({ isAuthenticated: false });
    expect(reloaded.config.connectionStatus).toBe('failed');
    expect(reloaded.config.connectionError).toBe('Provider quota exhausted');
  });

  it('also revokes an in-memory compatibility builtin after key withdrawal', () => {
    process.env.EXA_API_KEY = 'fixture-shared';
    const source = getBuiltinSources('ws', dir).find((entry) => entry.config.slug === 'exa')!;
    expect(isSourceUsable(source)).toBe(true);
    delete process.env.EXA_API_KEY;
    expect(isSourceUsable(source)).toBe(false);
    saveSourceConfig(dir, { ...source.config, name: 'Saved fallback' });
    expect(loadSource(dir, 'exa')!.config).toMatchObject({ isAuthenticated: false, connectionStatus: 'needs_auth' });
  });
});
