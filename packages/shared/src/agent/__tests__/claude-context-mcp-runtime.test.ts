import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeContext } from '../claude-context.ts';
import { ensureBuiltinMcpSources } from '../../sources/builtin-mcp.ts';
import { getSourceCredentialManager } from '../../sources/credential-manager.ts';
import { getToolchain } from '../../toolchain-runtime.ts';
import type { SourceConfig } from '@craft-agent/session-tools-core';
import { handleSourceTest } from '../../../../session-tools-core/src/handlers/source-test.ts';

describe('session MCP runtime resolution', () => {
  let root: string;
  const mocks: Array<{ mockRestore(): void }> = [];
  const envKeys = ['WEAVIATE_URL', 'WEAVIATE_API_KEY', 'MEM0_API_KEY', 'CONTEXT7_API_KEY'];
  let savedEnvironment: Array<string | undefined>;
  beforeEach(() => {
    savedEnvironment = envKeys.map(key => process.env[key]);
    envKeys.forEach(key => delete process.env[key]);
    root = mkdtempSync(join(tmpdir(), 'rox-session-mcp-'));
    ensureBuiltinMcpSources(root, { env: {} });
  });
  afterEach(() => {
    for (const mock of mocks.splice(0)) mock.mockRestore();
    envKeys.forEach((key, index) => {
      if (savedEnvironment[index] === undefined) delete process.env[key];
      else process.env[key] = savedEnvironment[index];
    });
    rmSync(root, { recursive: true, force: true });
  });
  const context = () => createClaudeContext({
    sessionId: 'test', workspaceId: 'workspace', workspacePath: root,
    onPlanSubmitted: () => {}, onAuthRequest: () => {},
  });
  const source = (slug: string): SourceConfig => JSON.parse(readFileSync(join(root, 'sources', slug, 'config.json'), 'utf-8'));

  test('resolves a Firecrawl vault token while preserving a disabled disk config', async () => {
    const manager = getSourceCredentialManager();
    mocks.push(spyOn(manager, 'getToken').mockResolvedValue('vault-firecrawl-key'));
    mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(null));
    const original = source('firecrawl-mcp');
    original.enabled = false;
    const resolved = await context().resolveStdioMcpSourceConfig!(original);
    expect(resolved.config?.env?.FIRECRAWL_API_KEY).toBe('vault-firecrawl-key');
    expect(resolved.config?.cwd).toBe(join(root, 'sources', 'firecrawl-mcp'));
    expect(original.enabled).toBe(false);
    expect(original.mcp?.env).toBeUndefined();
    expect(readFileSync(join(root, 'sources', 'firecrawl-mcp', 'config.json'), 'utf-8')).not.toContain('vault-firecrawl-key');
  });

  test('resolves Telegram encrypted field credentials through the runtime builder', async () => {
    const credential = { TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: 'vault-hash', TELEGRAM_SESSION_STRING: 'vault-session' };
    const manager = getSourceCredentialManager();
    mocks.push(spyOn(manager, 'getToken').mockResolvedValue(null));
    mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(credential));
    const resolved = await context().resolveStdioMcpSourceConfig!(source('telegram-mcp'));
    expect(resolved.config?.env).toMatchObject(credential);
    expect(resolved.error).toBeUndefined();
    expect(readFileSync(join(root, 'sources', 'telegram-mcp', 'config.json'), 'utf-8')).not.toContain('vault-');
  });

  test('keeps custom stdio sources usable without fetching built-in credentials', async () => {
    const manager = getSourceCredentialManager();
    const getToken = spyOn(manager, 'getToken').mockRejectedValue(new Error('Must not read generic source credentials'));
    mocks.push(getToken);
    const custom = {
      id: 'custom', slug: 'custom', name: 'Custom', type: 'mcp', enabled: false, provider: 'custom',
      mcp: { transport: 'stdio', command: '/custom/server', args: ['--stdio'], env: { CUSTOM: 'preserved' } },
    } as SourceConfig;
    const resolved = await context().resolveStdioMcpSourceConfig!(custom);
    expect(resolved.config).toMatchObject({ command: '/custom/server', args: ['--stdio'], env: { CUSTOM: 'preserved' } });
    expect(getToken).not.toHaveBeenCalled();
    expect(custom.enabled).toBe(false);
  });

  test('resolves Weaviate environment endpoint and bearer header without changing source config', async () => {
    process.env.WEAVIATE_URL = 'https://weaviate-runtime.example.test';
    process.env.WEAVIATE_API_KEY = 'weaviate-environment-key';
    const manager = getSourceCredentialManager();
    mocks.push(spyOn(manager, 'getToken').mockResolvedValue(null));
    mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(null));
    const original = source('weaviate');
    original.enabled = false;
    const originalJson = JSON.stringify(original);

    const resolved = await context().resolveHttpMcpSourceConfig!(original);

    expect(resolved?.config).toMatchObject({
      url: 'https://weaviate-runtime.example.test/v1/mcp', transport: 'http', authType: 'none',
      headers: { Authorization: 'Bearer weaviate-environment-key' },
    });
    expect(JSON.stringify(original)).toBe(originalJson);
    const persisted = readFileSync(join(root, 'sources', 'weaviate', 'config.json'), 'utf8');
    expect(persisted).not.toContain('weaviate-runtime.example.test');
    expect(persisted).not.toContain('weaviate-environment-key');
  });

  for (const [slug, envKey] of [['mem0', 'MEM0_API_KEY'], ['context7', 'CONTEXT7_API_KEY']]) {
    test(`resolves ${slug} environment credentials through the same remote runtime builder`, async () => {
      process.env[envKey!] = `${slug}-environment-key`;
      const manager = getSourceCredentialManager();
      mocks.push(spyOn(manager, 'getToken').mockResolvedValue(null));
      mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(null));
      const original = source(slug!);
      const originalJson = JSON.stringify(original);

      const resolved = await context().resolveHttpMcpSourceConfig!(original);

      expect(resolved?.config?.headers?.Authorization).toBe(`Bearer ${slug}-environment-key`);
      expect(resolved?.config?.url).toBe(original.mcp?.url);
      expect(resolved?.config?.authType).toBe('none');
      expect(JSON.stringify(original)).toBe(originalJson);
      expect(readFileSync(join(root, 'sources', slug!, 'config.json'), 'utf8')).not.toContain(`${slug}-environment-key`);
    });
  }

  test('forwards a managed OAuth vault token without replacing the source auth configuration', async () => {
    const manager = getSourceCredentialManager();
    mocks.push(spyOn(manager, 'getToken').mockResolvedValue('vault-mem0-oauth-token'));
    mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(null));
    const original = source('mem0');
    original.mcp!.authType = 'oauth';

    const resolved = await context().resolveHttpMcpSourceConfig!(original);

    expect(resolved?.config?.authType).toBe('oauth');
    expect(resolved?.config?.accessToken).toBe('vault-mem0-oauth-token');
    expect(resolved?.config?.headers?.Authorization).toBe('Bearer vault-mem0-oauth-token');
    expect(original.mcp?.headers).toBeUndefined();
    expect(readFileSync(join(root, 'sources', 'mem0', 'config.json'), 'utf8')).not.toContain('vault-mem0-oauth-token');
  });

  test('returns readiness failure for managed remote sources with missing setup', async () => {
    const manager = getSourceCredentialManager();
    mocks.push(spyOn(manager, 'getToken').mockResolvedValue(null));
    mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(null));

    const weaviate = await context().resolveHttpMcpSourceConfig!(source('weaviate'));
    const mem0 = await context().resolveHttpMcpSourceConfig!(source('mem0'));

    expect(weaviate?.config).toBeNull();
    expect(weaviate?.error).toContain('WEAVIATE_URL');
    expect(mem0?.config).toBeNull();
    expect(mem0?.error).toContain('MEM0_API_KEY');
  });

  test('leaves ordinary remote sources to the existing credential-cache flow', async () => {
    const manager = getSourceCredentialManager();
    const getToken = spyOn(manager, 'getToken').mockRejectedValue(new Error('Generic remote source must use the fallback'));
    mocks.push(getToken);
    const custom = {
      id: 'custom', slug: 'custom', name: 'Custom', type: 'mcp', enabled: true, provider: 'custom',
      mcp: { transport: 'http', url: 'https://custom.example.test/mcp', authType: 'oauth' },
    } as SourceConfig;

    expect(await context().resolveHttpMcpSourceConfig!(custom)).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });

  test('does not expose raw vault exceptions while resolving a remote source', async () => {
    const manager = getSourceCredentialManager();
    mocks.push(spyOn(manager, 'getToken').mockRejectedValue(new Error('vault rejected remote-secret-token')));
    mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(null));

    const resolved = await context().resolveHttpMcpSourceConfig!(source('mem0'));

    expect(resolved?.config).toBeNull();
    expect(resolved?.error).toContain('Check source setup and credentials');
    expect(resolved?.error).not.toContain('remote-secret-token');
  });

  test('the complete managed Mem0 source probe verifies environment authentication once without persisting it', async () => {
    process.env.MEM0_API_KEY = 'mem0-integration-environment-key';
    const manager = getSourceCredentialManager();
    const getToken = spyOn(manager, 'getToken').mockResolvedValue(null);
    mocks.push(getToken);
    mocks.push(spyOn(manager, 'getApiCredential').mockResolvedValue(null));
    const ctx = context();
    const original = source('mem0');
    original.isAuthenticated = true;
    ctx.saveSourceConfig!(original);
    let authHeader: string | undefined;
    ctx.validateMcpConnection = async config => {
      authHeader = config.headers?.Authorization;
      return { success: true, toolCount: 1 };
    };

    const result = await handleSourceTest(ctx, { sourceSlug: 'mem0', autoEnable: false });

    expect(result.isError).toBeFalsy();
    expect(authHeader).toBe('Bearer mem0-integration-environment-key');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).not.toContain('token missing');
    expect(result.content[0]?.text).not.toContain('mem0-integration-environment-key');
    const persisted = readFileSync(join(root, 'sources', 'mem0', 'config.json'), 'utf8');
    expect(persisted).not.toContain('mem0-integration-environment-key');
    expect(JSON.parse(persisted).mcp).toEqual(original.mcp);
    expect(JSON.parse(persisted).connectionStatus).toBe('connected');
  });

  test('the host probe launches managed Bun even when it is absent from PATH', async () => {
    const resolver = getToolchain().resolver;
    mocks.push(spyOn(resolver, 'findExecutable').mockResolvedValue(process.execPath));
    mocks.push(spyOn(resolver, 'toolchainPathPrefix').mockResolvedValue('/managed/runtime/bin'));
    const fixture = fileURLToPath(new URL('../../mcp/__tests__/fixtures/mcp-server-good.mjs', import.meta.url));
    const result = await context().validateStdioMcpConnection!({ command: 'bun', args: [fixture] });
    expect(result.success).toBe(true);
    expect(result.toolNames).toEqual(['echo']);
  });
});
