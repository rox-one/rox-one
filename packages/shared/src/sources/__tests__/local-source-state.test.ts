import { afterEach, beforeEach, describe, expect, test, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getLocalSourceFolderState, isSourceUsable, loadSourceConfig } from '../storage.ts';
import { SourceManager } from '../../agent/core/source-manager.ts';
import { SourceCredentialManager } from '../credential-manager.ts';
import { BUILTIN_MCP_CATALOG } from '../builtin-mcp.ts';
import { SourceServerBuilder } from '../server-builder.ts';
import type { FolderSourceConfig, LoadedSource } from '../types.ts';

describe('local folder source actual storage and agent consumer', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rox-local-state-')); mkdirSync(join(root, 'sources', 'folder'), { recursive: true }); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  function source(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
    return { workspaceRootPath: root, workspaceId: 'test', folderPath: join(root, 'sources', 'folder'), guide: null,
      config: { id: 'folder', slug: 'folder', name: 'Folder', provider: 'local', enabled: true, type: 'local', local: { path: root, format: 'markdown' }, ...overrides } };
  }

  test('resolves WORKSPACE/SOURCE_DIR/relative paths without persisting health or creating missing folders', () => {
    const folder = source({ local: { path: '${SOURCE_DIR}/data', format: 'markdown' }, connectionStatus: 'failed' });
    const path = join(folder.folderPath, 'data');
    const configPath = join(folder.folderPath, 'config.json');
    writeFileSync(configPath, JSON.stringify(folder.config));
    const original = readFileSync(configPath, 'utf8');
    expect(getLocalSourceFolderState(folder)).toMatchObject({ path, available: false });
    expect(isSourceUsable(folder)).toBe(false);
    mkdirSync(path);
    expect(getLocalSourceFolderState(folder)).toEqual({ path, available: true });
    expect(isSourceUsable(folder)).toBe(true);
    expect(loadSourceConfig(root, 'folder')!.local!.path).toBe(path);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
    expect(getLocalSourceFolderState(source({ local: { path: '${WORKSPACE}/sources', format: 'markdown' } })).path).toBe(join(root, 'sources'));
    expect(getLocalSourceFolderState(source({ local: { path: 'sources', format: 'markdown' } })).path).toBe(join(root, 'sources'));
    rmSync(path, { recursive: true });
    writeFileSync(path, 'a file is not a readable folder');
    expect(getLocalSourceFolderState(folder).available).toBe(false);
    expect(getLocalSourceFolderState(source({ local: undefined })).available).toBe(false);
  });

  test('selected readable folders remain active and explicit paths/guides persist on every agent turn', () => {
    const folder = source({ mcp: { transport: 'http', url: 'https://old.example', authType: 'bearer' }, isAuthenticated: false });
    folder.guide = { raw: 'custom instructions' };
    const manager = new SourceManager();
    manager.updateActiveState([], [], ['folder']);
    manager.setAllSources([folder]);
    expect(isSourceUsable(folder)).toBe(true); // Inactive old MCP auth does not own a local pointer.
    expect(manager.isSourceActive('folder')).toBe(true);
    for (let turn = 0; turn < 2; turn++) {
      const context = manager.formatSourceState();
      expect(context).toContain('folder (local files)');
      expect(context).toContain(`Local folder folder: ${root} (available)`);
      expect(context).toContain(join(folder.folderPath, 'guide.md'));
      expect(context).toContain('Do not call MCP tools for these folders');
      expect(context).not.toContain('folder (no tools)');
      expect(context).not.toContain('source_oauth_trigger');
    }
    expect(manager.detectInactiveSourceToolError('mcp__folder__read', 'No such tool available: mcp__folder__read')).toBeNull();
  });

  test('explicit empty selection, disabled folders and stale server names never implicitly activate a folder', () => {
    const folder = source();
    const manager = new SourceManager();
    manager.setAllSources([folder]);
    manager.updateActiveState(['folder'], [], []);
    expect(manager.isSourceActive('folder')).toBe(false);
    expect(manager.getIntendedSlugs().size).toBe(0);
    manager.updateActiveState([], [], ['folder']);
    folder.config.enabled = false;
    expect(manager.isSourceActive('folder')).toBe(false);
    expect(isSourceUsable(folder)).toBe(false);
    expect(manager.formatSourceState()).toContain('folder (disabled)');
    expect(manager.formatSourceState()).not.toContain('Local folder folder:');
    folder.config.enabled = true;
    folder.config.local!.path = join(root, 'absent');
    manager.updateActiveState(['folder'], [], ['folder']);
    const context = manager.formatSourceState();
    expect(manager.isSourceActive('folder')).toBe(false);
    expect(context).toContain('folder (folder unavailable)');
    expect(context).toContain('Check the folder path and filesystem permissions');
    expect(context).not.toContain('Re-authenticate');
  });

  test('metadata/server arrival order yields the same implicit folder state and retains current setup guards', () => {
    const folder = source();
    for (const metadataFirst of [false, true]) {
      const manager = new SourceManager();
      if (metadataFirst) manager.setAllSources([folder]);
      manager.updateActiveState([], []);
      if (!metadataFirst) manager.setAllSources([folder]);
      expect(manager.getActiveSlugs()).toEqual(new Set(['folder']));
    }
    const managed = source({ slug: 'firecrawl-mcp', type: 'mcp', local: undefined, connectionStatus: 'untested', connectionError: 'Install supported runtime' });
    const manager = new SourceManager();
    manager.setAllSources([managed]); manager.updateActiveState([], [], ['firecrawl-mcp']);
    expect(manager.formatSourceState()).toContain('awaiting setup or a supported local runtime');
  });

  test('ordinary local/no-auth sources skip vault but managed stdio still resolves its current credential identity', async () => {
    const credentials = new SourceCredentialManager();
    const id = spyOn(credentials, 'getCredentialId').mockImplementation(() => { throw new Error('credential consumer reached'); });
    try {
      expect(await credentials.load(source())).toBeNull();
      expect(await credentials.load(source({ type: 'mcp', local: undefined, mcp: { transport: 'stdio', command: 'custom', authType: 'bearer' } }))).toBeNull();
      expect(await credentials.load(source({ type: 'mcp', local: undefined, mcp: { transport: 'http', url: 'https://public.example', authType: 'none' } }))).toBeNull();
      expect(id).not.toHaveBeenCalled();
      const spec = BUILTIN_MCP_CATALOG.find(spec => spec.slug === 'firecrawl-mcp')!;
      const managed = source({ id: 'builtin-mcp-firecrawl-mcp', slug: spec.slug, provider: 'builtin-mcp', type: 'mcp', local: undefined, mcp: { ...spec.mcp } });
      // Managed identity is defined by current catalog/provenance, not just slug.
      // Use the actual persisted seed config for this control.
      const { ensureBuiltinMcpSources } = await import('../builtin-mcp.ts');
      ensureBuiltinMcpSources(root);
      managed.config = loadSourceConfig(root, spec.slug)!;
      await expect(credentials.load(managed)).rejects.toThrow('credential consumer reached');
      expect(id).toHaveBeenCalledTimes(1);
    } finally { id.mockRestore(); }
  });

  test('public HTTP source ignores obsolete authentication state while explicit bearer remains guarded', () => {
    const builder = new SourceServerBuilder();
    const remote = source({ type: 'mcp', local: undefined, isAuthenticated: true, mcp: { transport: 'http', url: 'https://public.example/mcp' } });
    expect(builder.buildMcpServer(remote, null)).toEqual({ type: 'http', url: 'https://public.example/mcp' });
    remote.config.mcp!.authType = 'bearer';
    expect(builder.buildMcpServer(remote, null)).toBeNull();
    expect(builder.buildMcpServer(remote, 'owned-token')).toMatchObject({ headers: { Authorization: 'Bearer owned-token' } });
  });
});
