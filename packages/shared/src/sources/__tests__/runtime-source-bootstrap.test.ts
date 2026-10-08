import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SourceServerBuilder, SERVER_BUILD_ERRORS } from '../server-builder.ts';
import { SourceCredentialManager, sourceNeedsAuthentication } from '../credential-manager.ts';
import { isSourceUsable, loadSourceConfig } from '../storage.ts';
import type { FolderSourceConfig, LoadedSource } from '../types.ts';
import * as credentials from '../../credentials/index.ts';

function source(config: Partial<FolderSourceConfig>): LoadedSource {
  return {
    workspaceId: 'fixture', workspaceRootPath: 'C:/fixture', folderPath: 'C:/fixture/sources/test', guide: null,
    config: { id: 'fixture', slug: 'test', name: 'Test', provider: 'fixture', enabled: true, type: 'local', ...config },
  };
}

describe('native/public source bootstrap', () => {
  test('local sources and stdio do not resolve credential slots, even with stale auth fields', async () => {
    const manager = new SourceCredentialManager();
    const idSpy = spyOn(manager, 'getCredentialId').mockImplementation(() => {
      throw new Error('No credential slot should be read');
    });
    const vaultSpy = spyOn(credentials, 'getCredentialManager').mockImplementation(() => {
      throw new Error('No credential vault should be opened');
    });
    try {
      for (const config of [
        { type: 'local' as const, local: { path: 'C:/notes' } },
        { type: 'mcp' as const, mcp: { transport: 'stdio' as const, command: 'node', authType: 'oauth' as const } },
        { type: 'mcp' as const, mcp: { url: 'https://example.com/mcp', authType: 'none' as const } },
        { type: 'mcp' as const, mcp: { url: 'https://example.com/mcp' } },
      ]) {
        expect(await manager.load(source(config))).toBeNull();
      }
      expect(idSpy).not.toHaveBeenCalled();
      expect(vaultSpy).not.toHaveBeenCalled();
    } finally {
      idSpy.mockRestore();
      vaultSpy.mockRestore();
    }
  });

  test('usability follows the source type and agrees with authentication requirements', () => {
    // Local usability follows live folder evidence, so the local case needs a
    // real directory; the claim under test is auth ownership by source type.
    const localDir = mkdtempSync(join(tmpdir(), 'source-usable-'));
    try {
      for (const config of [
        { type: 'local' as const, local: { path: localDir }, api: { baseUrl: 'https://old.example', authType: 'bearer' as const } },
        { type: 'mcp' as const, mcp: { transport: 'stdio' as const, command: 'node', authType: 'oauth' as const } },
        { type: 'api' as const, api: { baseUrl: 'https://public.example', authType: 'none' as const }, mcp: { authType: 'oauth' as const } },
      ]) {
        const s = source({ ...config, isAuthenticated: false });
        expect(sourceNeedsAuthentication(s)).toBe(false);
        expect(isSourceUsable(s)).toBe(true);
        expect(isSourceUsable(source({ ...config, enabled: false }))).toBe(false);
      }
    } finally {
      rmSync(localDir, { recursive: true, force: true });
    }
    const authenticatedApi = source({ type: 'api', api: { baseUrl: 'https://example.com', authType: 'bearer' } });
    expect(sourceNeedsAuthentication(authenticatedApi)).toBe(true);
    expect(isSourceUsable(authenticatedApi)).toBe(false);
  });

  test('public MCP with omitted auth type builds without a token despite isAuthenticated=true', async () => {
    const builder = new SourceServerBuilder();
    const s = source({ type: 'mcp', isAuthenticated: true, mcp: { url: 'https://example.com/mcp' } });
    const built = await builder.buildAll([{ source: s }]);
    expect(built.mcpServers.test).toEqual({ type: 'http', url: 'https://example.com/mcp' });
    expect(built.errors).toEqual([]);
  });

  test('explicit bearer/OAuth sources still reject missing tokens and layer credential headers', async () => {
    const builder = new SourceServerBuilder();
    for (const authType of ['bearer', 'oauth'] as const) {
      const s = source({ type: 'mcp', isAuthenticated: true, mcp: {
        url: 'https://example.com/mcp', authType, headers: { 'X-Api-Key': 'static' },
      } });
      expect((await builder.buildAll([{ source: s }])).errors).toEqual([{ sourceSlug: 'test', error: SERVER_BUILD_ERRORS.AUTH_REQUIRED }]);
      expect(builder.buildMcpServer(s, 'test-token', { 'X-Api-Key': 'stored' })).toEqual({
        type: 'http', url: 'https://example.com/mcp', headers: { 'X-Api-Key': 'stored', Authorization: 'Bearer test-token' },
      });
    }
  });

  test('local folder sources are not MCP/API servers or server build errors', async () => {
    const built = await new SourceServerBuilder().buildAll([{ source: source({ local: { path: 'C:/notes' } }) }]);
    expect(built).toEqual({ mcpServers: {}, apiServers: {}, errors: [] });
  });

  test('malformed stdio and public MCP configs report configuration errors, not authentication', async () => {
    const built = await new SourceServerBuilder().buildAll([
      { source: source({ slug: 'missing-command', type: 'mcp', mcp: { transport: 'stdio' } }) },
      { source: source({ slug: 'missing-url', type: 'mcp', mcp: { authType: 'none' } }) },
      { source: source({ slug: 'missing-api', type: 'api' }) },
    ]);
    expect(built.errors.map(e => e.sourceSlug)).toEqual(['missing-command', 'missing-url', 'missing-api']);
    expect(built.errors.every(e => e.error !== SERVER_BUILD_ERRORS.AUTH_REQUIRED)).toBe(true);
    expect(built.mcpServers).toEqual({});
  });
});

describe('local source path context', () => {
  let workspace: string | undefined;
  afterEach(() => { if (workspace) rmSync(workspace, { recursive: true, force: true }); });

  test('relative and workspace/source variables resolve independently of the application cwd', () => {
    workspace = mkdtempSync(join(tmpdir(), 'source-context-'));
    const dir = join(workspace, 'sources', 'test');
    mkdirSync(dir, { recursive: true });
    for (const [input, expected] of [
      ['notes', join(workspace, 'notes')],
      ['${WORKSPACE}/notes', join(workspace, 'notes')],
      ['${SOURCE_DIR}/data', join(dir, 'data')],
    ]) {
      const file = join(dir, 'config.json');
      const content = JSON.stringify({ id: 'test', slug: 'test', name: 'Test', enabled: true, type: 'local', local: { path: input } });
      writeFileSync(file, content);
      expect(loadSourceConfig(workspace, 'test')?.local?.path).toBe(expected);
      expect(readFileSync(file, 'utf8')).toBe(content);
    }
  });
});
