/** Real fake-OMP NDJSON process → permission gate → in-process MCP API → fetch. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OmpAgent } from '../omp-agent.ts';
import { cleanupModeState } from '../mode-manager.ts';
import { permissionsConfigCache, saveWorkspacePermissions } from '../permissions-config.ts';
import { McpClientPool } from '../../mcp/mcp-pool.ts';
import { ensureBuiltinSources } from '../../sources/builtin-sources.ts';
import { loadWorkspaceSources, saveSourceConfig } from '../../sources/storage.ts';
import { SourceServerBuilder } from '../../sources/server-builder.ts';
import { createMockBackendConfig, createMockSession, createMockWorkspace } from './test-utils.ts';

const FAKE_OMP = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-omp-rpc.mjs');
const ENV_NAMES = ['OMP_CLI_PATH', 'FAKE_OMP_JOURNAL', 'FAKE_OMP_HOST_TOOL', 'FAKE_OMP_HOST_TOOL_ARGS', 'FAKE_OMP_BACKSTOP_MS', 'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY', 'ROX_SERVICE_SECRETS_FILE', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY', 'CRAFT_FIRECRAWL_API_KEY', 'ROX_FIRECRAWL_API_KEY', 'ROX_BRAVE_API_KEY', 'ROX_E2B_API_KEY'];

describe('OMP predefined provider reads without interactive permission', () => {
  let dir: string;
  let previous: Record<string, string | undefined>;
  let pool: McpClientPool;
  let agent: OmpAgent | undefined;
  let sessionId: string;
  let requests: string[];
  let fetchSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rox-omp-safe-provider-'));
    previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.ROX_SERVICE_SECRETS_FILE = join(dir, 'absent.env');
    for (const name of ['EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY']) process.env[name] = 'provider-fixture';
    process.env.OMP_CLI_PATH = FAKE_OMP;
    process.env.FAKE_OMP_JOURNAL = join(dir, 'journal.jsonl');
    process.env.FAKE_OMP_BACKSTOP_MS = '2000';
    chmodSync(FAKE_OMP, 0o755);
    ensureBuiltinSources(dir);
    pool = new McpClientPool({ workspaceRootPath: dir });
    sessionId = `omp-safe-provider-${crypto.randomUUID()}`;
    requests = [];
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: unknown) => {
      requests.push(String(url)); return Response.json({ results: [{ title: 'Verified read fixture' }] });
    }) as typeof fetch);
  });
  afterEach(async () => {
    agent?.destroy(); agent = undefined;
    await pool.disconnectAll();
    cleanupModeState(sessionId);
    permissionsConfigCache.invalidateWorkspace(dir);
    fetchSpy.mockRestore();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(slug: string, args: Record<string, unknown>, options: { tool?: string; mode?: 'safe' | 'ask'; change?: 'origin' | 'disabled' | 'withdraw' | 'blocked' } = {}) {
    const sources = loadWorkspaceSources(dir).filter((source) => source.config.slug === slug);
    const built = await new SourceServerBuilder().buildAll(sources.map((source) => ({ source, credential: 'provider-fixture' })));
    expect(built.errors).toEqual([]);
    process.env.FAKE_OMP_HOST_TOOL = options.tool ?? `mcp__${slug}__api_${slug}`;
    process.env.FAKE_OMP_HOST_TOOL_ARGS = JSON.stringify(args);
    agent = new OmpAgent(createMockBackendConfig({
      workspace: createMockWorkspace({ rootPath: dir }),
      session: createMockSession({ id: sessionId, workspaceRootPath: dir }),
      mcpPool: pool,
      isHeadless: true,
    }));
    agent.setPermissionMode(options.mode ?? 'safe');
    agent.setAllSources(sources);
    await agent.setSourceServers({}, built.apiServers, [slug]);
    if (options.change === 'origin') saveSourceConfig(dir, { ...sources[0]!.config, api: { ...sources[0]!.config.api!, baseUrl: 'https://untrusted.example' } });
    if (options.change === 'disabled') saveSourceConfig(dir, { ...sources[0]!.config, enabled: false });
    if (options.change === 'withdraw') delete process.env.EXA_API_KEY;
    if (options.change === 'blocked') saveWorkspacePermissions(dir, { blockedTools: [`mcp__${slug}__api_${slug}`] });
    const prompts: string[] = [];
    const instance = agent;
    instance.onPermissionRequest = (request) => { prompts.push(request.toolName); instance.respondToPermission(request.requestId, false); };
    const events = [];
    for await (const event of instance.chat('Retrieve web information for my radar')) events.push(event);
    expect(events.some((event) => event.type === 'complete')).toBe(true);
    const path = process.env.FAKE_OMP_JOURNAL!;
    expect(existsSync(path)).toBe(true);
    const result = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((entry) => entry.kind === 'host_tool_result');
    expect(result).toBeDefined();
    return { prompts, result };
  }

  for (const [slug, args, endpoint] of [
    ['exa', { method: 'POST', path: '/search', params: { query: 'Rox', numResults: 1 } }, 'https://api.exa.ai/search'],
    ['firecrawl', { method: 'POST', path: '/v2/scrape', params: { url: 'https://example.com', formats: ['markdown'] } }, 'https://api.firecrawl.dev/v2/scrape'],
    ['brave', { method: 'GET', path: '/res/v1/web/search', params: { q: 'Rox' } }, 'https://api.search.brave.com/res/v1/web/search?q=Rox'],
  ] as const) {
    it(`runs the actual ${slug} read through the MCP proxy in safe mode without a dialog`, async () => {
      const { prompts, result } = await run(slug, args);
      expect(prompts).toEqual([]);
      expect(requests).toEqual([endpoint]);
      expect(result.isError).toBe(false);
      expect(JSON.stringify(result)).toContain('Verified read fixture');
      expect(JSON.stringify(result)).not.toContain('provider-fixture');
    }, 15_000);
  }
  it('also allows the trusted read in ask mode without a dialog', async () => {
    const { prompts, result } = await run('exa', { method: 'POST', path: '/contents' }, { mode: 'ask' });
    expect(prompts).toEqual([]); expect(result.isError).toBe(false); expect(requests).toHaveLength(1);
  }, 15_000);
  for (const change of ['origin', 'disabled', 'withdraw', 'blocked'] as const) {
    it(`preserves permission boundaries after ${change} while the old source proxy is still mounted`, async () => {
      const { prompts, result } = await run('exa', { method: 'POST', path: '/search' }, { change });
      expect(prompts).toEqual(['mcp__exa__api_exa']); expect(result.isError).toBe(true); expect(requests).toEqual([]);
    }, 15_000);
  }
  for (const [slug, args, tool] of [
    ['exa', { method: 'DELETE', path: '/search' }, undefined],
    ['exa', { method: 'POST', path: '/unknown' }, undefined],
    ['firecrawl', { method: 'POST', path: '/v2/scrape', params: { actions: [{ type: 'click', selector: '#send' }] } }, undefined],
    ['e2b', { method: 'POST', path: '/v2/sandboxes' }, undefined],
    ['e2b', { code: 'print(42)', language: 'python' }, 'mcp__e2b__execute_code'],
  ] as const) {
    it(`keeps ${tool ?? `${slug} ${'method' in args ? args.method : 'code'} ${'path' in args ? args.path : ''}`} behind its original permission boundary`, async () => {
      const { prompts, result } = await run(slug, args, { tool });
      expect(prompts).toEqual([tool ?? `mcp__${slug}__api_${slug}`]); expect(result.isError).toBe(true); expect(requests).toEqual([]);
    }, 15_000);
  }
});
