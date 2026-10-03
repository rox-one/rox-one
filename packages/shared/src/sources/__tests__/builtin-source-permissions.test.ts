import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureBuiltinSources } from '../builtin-sources.ts';
import { isBuiltinReadOnlyToolCall } from '../builtin-permissions.ts';
import { loadSourceConfig, saveSourceConfig } from '../storage.ts';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';
import { permissionsConfigCache, saveWorkspacePermissions } from '../../agent/permissions-config.ts';

describe('trusted built-in read-only API permissions', () => {
  let dir: string;
  let previous: Record<string, string | undefined>;
  const names = ['EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY', 'ROX_SERVICE_SECRETS_FILE', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY', 'CRAFT_FIRECRAWL_API_KEY', 'ROX_FIRECRAWL_API_KEY', 'ROX_BRAVE_API_KEY', 'ROX_E2B_API_KEY'];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rox-builtin-permissions-'));
    previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    process.env.ROX_SERVICE_SECRETS_FILE = join(dir, 'absent.env');
    for (const name of ['EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY']) process.env[name] = 'permission-fixture';
    ensureBuiltinSources(dir);
  });
  afterEach(() => {
    permissionsConfigCache.invalidateWorkspace(dir);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function allowed(toolName: string, args: Record<string, unknown>, activeSourceSlugs?: string[]) {
    return shouldAllowToolInMode(toolName, args, 'safe', { permissionsContext: { workspaceRootPath: dir, activeSourceSlugs } }).allowed;
  }
  it('allows only predefined managed search/content retrieval POST paths in Explore mode', () => {
    for (const path of ['/search', '/contents', '/findSimilar']) expect(allowed('mcp__exa__api_exa', { method: 'POST', path }, ['exa'])).toBe(true);
    for (const path of ['/v2/scrape', '/v2/map']) expect(allowed('mcp__firecrawl__api_firecrawl', { method: 'POST', path }, ['firecrawl'])).toBe(true);
    expect(allowed('api_exa', { method: 'POST', path: '/search' }, ['exa'])).toBe(true);
    expect(isBuiltinReadOnlyToolCall(loadSourceConfig(dir, 'brave')!, 'mcp__brave__api_brave', { method: 'GET', path: '/res/v1/web/search?q=Rox' })).toBe(true);
  });
  it('does not grant other sources the same path and leaves E2B/code, crawl jobs, mutations and unknown operations restricted', () => {
    for (const [tool, args] of [
      ['mcp__other__api_other', { method: 'POST', path: '/search' }],
      ['mcp__exa__api_exa', { method: 'DELETE', path: '/search' }],
      ['mcp__exa__api_exa', { method: 'POST', path: '/tasks' }],
      ['mcp__exa__api_exa', { method: 'POST', path: 'https://api.exa.ai/search' }],
      ['mcp__exa__api_exa', { method: 'POST', path: '/contents/../search' }],
      ['mcp__firecrawl__api_firecrawl', { method: 'POST', path: '/v2/crawl' }],
      ['mcp__firecrawl__api_firecrawl', { method: 'POST', path: '/v2/scrape', params: { actions: [{ type: 'click', selector: '#submit' }] } }],
      ['mcp__firecrawl__api_firecrawl', { method: 'POST', path: '/v2/scrape', params: { _rawBody: '{"actions":[]}' } }],
      ['mcp__e2b__api_e2b', { method: 'POST', path: '/v2/sandboxes' }],
      ['mcp__e2b__execute_code', { code: 'print(42)' }],
    ] as const) expect(allowed(tool, args)).toBe(false);
  });
  it('rechecks enabled state, activation, provider identity/origin and live credentials instead of granting by slug', () => {
    const args = { method: 'POST', path: '/search' };
    expect(allowed('mcp__exa__api_exa', args, [])).toBe(false);
    const config = loadSourceConfig(dir, 'exa')!;
    for (const altered of [
      { ...config, enabled: false },
      { ...config, id: 'user-exa' },
      { ...config, api: { ...config.api!, baseUrl: 'https://other.example' } },
      { ...config, api: { ...config.api!, headerName: 'Different' } },
    ]) {
      saveSourceConfig(dir, altered);
      expect(allowed('mcp__exa__api_exa', args)).toBe(false);
    }
    saveSourceConfig(dir, config);
    expect(allowed('mcp__exa__api_exa', args)).toBe(true);
    delete process.env.EXA_API_KEY;
    expect(allowed('mcp__exa__api_exa', args)).toBe(false);
    expect(isBuiltinReadOnlyToolCall(config, 'mcp__exa__api_exa', args)).toBe(false);
  });
  it('preserves an explicit workspace tool restriction', () => {
    saveWorkspacePermissions(dir, { blockedTools: ['mcp__exa__api_exa'] });
    expect(allowed('mcp__exa__api_exa', { method: 'POST', path: '/search' })).toBe(false);
  });
});
