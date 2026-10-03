import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_MCP_CATALOG,
  BUILTIN_AGENT_SKILL_PACKS,
  buildRuntimeBuiltinMcpConfig,
  ensureBuiltinMcpSources,
  getBuiltinMcpReadiness,
  getDefaultMcpSourceSlugs,
  getEnabledBuiltinMcpSourceSlugs,
} from '../builtin-mcp.ts';
import type { FolderSourceConfig, LoadedSource } from '../types.ts';
import { SourceServerBuilder } from '../server-builder.ts';
import { SourceCredentialManager, isMultiHeaderCredential, sourceNeedsAuthentication } from '../credential-manager.ts';
import { markSourceAuthenticated } from '../storage.ts';
import { validateSourceConfig } from '../../config/validators.ts';

describe('built-in MCP provisioning', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rox-builtin-mcp-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function config(slug: string): FolderSourceConfig {
    return JSON.parse(readFileSync(join(root, 'sources', slug, 'config.json'), 'utf-8'));
  }
  function save(source: FolderSourceConfig): void {
    writeFileSync(join(root, 'sources', source.slug, 'config.json'), JSON.stringify(source));
  }
  function loaded(source: FolderSourceConfig): LoadedSource {
    return { config: source, workspaceId: 'test', workspaceRootPath: root, folderPath: join(root, 'sources', source.slug), guide: null };
  }

  it('seeds verified servers without exposing secrets or claiming a connection', () => {
    const env = { FIRECRAWL_API_KEY: 'secret-firecrawl', TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'secret-hash', TELEGRAM_SESSION_STRING: 'secret-session', MEM0_API_KEY: 'secret-mem0', WEAVIATE_URL: 'https://knowledge.example', WEAVIATE_API_KEY: 'secret-weaviate' };
    expect(ensureBuiltinMcpSources(root, { platform: 'linux', env }).created).toHaveLength(13);
    for (const spec of BUILTIN_MCP_CATALOG) {
      const source = config(spec.slug);
      expect(source.connectionStatus).not.toBe('connected');
      expect(JSON.stringify(source)).not.toContain('secret-');
      expect(validateSourceConfig(source).valid).toBe(true);
    }
    expect(config('firecrawl-mcp').connectionStatus).toBe('untested');
    expect(config('windows-mcp').connectionStatus).toBe('local_disabled');
    expect(ensureBuiltinMcpSources(root).created).toEqual([]);
    expect(BUILTIN_AGENT_SKILL_PACKS.map(pack => pack.slug)).toEqual(['superpowers', 'understand-anything']);
    expect(BUILTIN_MCP_CATALOG.some(spec => spec.slug === 'superpowers')).toBe(false);
  });

  it('preserves user edits and disables while choosing only real available sources', () => {
    ensureBuiltinMcpSources(root, { platform: 'linux', env: {} });
    const source = config('playwright');
    source.enabled = false;
    source.name = 'My browser';
    source.mcp!.args = ['my-custom-version'];
    save(source);
    ensureBuiltinMcpSources(root);
    expect(config('playwright')).toEqual(source);
    expect(getDefaultMcpSourceSlugs(root, { platform: 'linux', env: {} })).toEqual(['deepwiki', 'context7', 'codegraph', 'qmd', 'qdrant']);
    expect(getDefaultMcpSourceSlugs(join(root, 'unseeded'))).toEqual([]);
    expect(getEnabledBuiltinMcpSourceSlugs(root, { platform: 'linux', env: {} })).toEqual(['deepwiki', 'context7', 'firecrawl-mcp', 'telegram-mcp', 'codegraph', 'qmd', 'weaviate', 'qdrant', 'mem0']);
  });

  it('keeps existing Firecrawl API source independent', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    expect(config('firecrawl-mcp').type).toBe('mcp');
    expect(getBuiltinMcpReadiness(config('firecrawl-mcp'), { env: {} }).status).toBe('needs_auth');
    expect(getBuiltinMcpReadiness(config('firecrawl-mcp'), { env: { ROX_FIRECRAWL_API_KEY: 'key' } }).status).toBe('ready');
  });

  it('injects upstream credentials only in memory and accepts encrypted vault tokens', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('firecrawl-mcp');
    const runtime = buildRuntimeBuiltinMcpConfig(source, { env: {}, token: 'vault-secret' });
    expect(runtime.mcp?.env?.FIRECRAWL_API_KEY).toBe('vault-secret');
    expect(source.mcp?.env).toBeUndefined();
    expect(config('firecrawl-mcp').mcp?.env).toBeUndefined();
    source.isAuthenticated = true;
    save(source);
    expect(getDefaultMcpSourceSlugs(root, { platform: 'linux', env: {} })).toContain('firecrawl-mcp');
    const server = new SourceServerBuilder().buildMcpServer(loaded(source), 'vault-secret');
    expect(server?.type).toBe('stdio');
    if (server?.type === 'stdio') expect(server.env?.FIRECRAWL_API_KEY).toBe('vault-secret');
  });

  it('resolves platform credentials and remote storage before the final stdio merge', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const firecrawl = config('firecrawl-mcp');
    firecrawl.mcp!.platform = { [process.platform]: { env: { FIRECRAWL_API_KEY: 'platform-key' } } };
    expect(getBuiltinMcpReadiness(firecrawl, { env: {} }).status).toBe('ready');
    expect(new SourceServerBuilder().buildMcpServer(loaded(firecrawl), null)).toMatchObject({
      type: 'stdio', env: { FIRECRAWL_API_KEY: 'platform-key' },
    });
    const qdrant = config('qdrant');
    qdrant.mcp!.platform = { [process.platform]: { env: { QDRANT_URL: 'https://platform-vectors.example' } } };
    const server = new SourceServerBuilder().buildMcpServer(loaded(qdrant), null);
    expect(server).toMatchObject({ type: 'stdio', env: { QDRANT_URL: 'https://platform-vectors.example' } });
    if (server?.type === 'stdio') expect(server.env?.QDRANT_LOCAL_PATH).toBeUndefined();
    expect(qdrant.mcp?.env?.QDRANT_LOCAL_PATH).toBe('${SOURCE_DIR}/storage');
  });

  it('accepts Telegram vault fields and authorized session files without PyPI name collision', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('telegram-mcp');
    expect(source.mcp?.args?.join(' ')).toContain('git+https://github.com/chigwell/telegram-mcp@');
    const credential = { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'hash', TELEGRAM_SESSION_STRING: 'session' };
    expect(getBuiltinMcpReadiness(source, { env: {}, credential }).status).toBe('ready');
    const runtime = buildRuntimeBuiltinMcpConfig(source, { env: {}, credential });
    expect(runtime.mcp?.env).toEqual(credential);
    expect(new SourceCredentialManager().getCredentialId(loaded(source)).type).toBe('source_apikey');
    expect(new SourceCredentialManager().getCredentialId(loaded(config('firecrawl-mcp'))).type).toBe('source_bearer');
    const options = { env: { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'hash', TELEGRAM_SESSION_NAME: '/private/session' }, fileExists: (path: string) => path === '/private/session.session' };
    expect(getBuiltinMcpReadiness(source, options).status).toBe('ready');
    expect(getBuiltinMcpReadiness(source, { ...options, fileExists: () => false }).status).toBe('needs_auth');
  });

  it('resolves existing Telegram session files against the source cwd before authentication checks', async () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('telegram-mcp');
    const folderPath = join(root, 'sources', source.slug);
    const sessionPath = join(folderPath, 'sessions', 'authorized');
    mkdirSync(join(folderPath, 'sessions'));
    writeFileSync(`${sessionPath}.session`, 'existing Telethon session');
    for (const sessionName of ['sessions/authorized', '${SOURCE_DIR}/sessions/authorized', '${WORKSPACE}/sources/telegram-mcp/sessions/authorized']) {
      source.mcp!.env = { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'hash', TELEGRAM_SESSION_NAME: sessionName };
      const before = JSON.stringify(source);
      save(source);
      expect(sourceNeedsAuthentication(loaded(source))).toBe(false);
      expect(getDefaultMcpSourceSlugs(root, { env: {} })).toContain('telegram-mcp');
      const server = new SourceServerBuilder().buildMcpServer(loaded(source), null);
      expect(server).toMatchObject({ type: 'stdio', cwd: folderPath, env: { TELEGRAM_SESSION_NAME: sessionPath } });
      const all = await new SourceServerBuilder().buildAll([{ source: loaded(source) }]);
      expect(all.errors).toEqual([]);
      expect(all.mcpServers['telegram-mcp']).toEqual(server!);
      expect(JSON.stringify(source)).toBe(before);
      expect(config(source.slug).mcp?.env?.TELEGRAM_SESSION_NAME).toBe(sessionName);
    }
    source.mcp!.env!.TELEGRAM_SESSION_NAME = '${SOURCE_DIR}/missing';
    expect(sourceNeedsAuthentication(loaded(source))).toBe(true);
    expect(new SourceServerBuilder().buildMcpServer(loaded(source), null)).toBeNull();
  });

  it('accepts upstream Telegram pools and named accounts from runtime environment and encrypted credentials', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('telegram-mcp');
    const folderPath = join(root, 'sources', source.slug);
    const pathOptions = { workspaceRootPath: root, sourceFolderPath: folderPath };
    const account = { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'hash' };
    const sessionVariants: Record<string, string>[] = [
      { TELEGRAM_SESSION_STRINGS: 'slot-one, slot-two;\nslot-three' },
      { TELEGRAM_SESSION_STRING_WORK: 'work-session' },
    ];
    for (const sessions of sessionVariants) {
      const before = JSON.stringify(source);
      const options = { ...pathOptions, env: { ...account, ...sessions } };
      expect(getBuiltinMcpReadiness(source, options).status).toBe('ready');
      expect(buildRuntimeBuiltinMcpConfig(source, options).mcp?.env).toMatchObject(sessions);
      expect(getBuiltinMcpReadiness(source, { ...pathOptions, env: {}, credential: { ...account, ...sessions } }).status).toBe('ready');
      expect(buildRuntimeBuiltinMcpConfig(source, { ...pathOptions, env: {}, credential: { ...account, ...sessions } }).mcp?.env).toMatchObject(sessions);
      expect(JSON.stringify(source)).toBe(before);
      expect(JSON.stringify(config(source.slug))).not.toContain('slot-one');
    }
    expect(getBuiltinMcpReadiness(source, { env: { ...account, TELEGRAM_SESSION_STRINGS: ' ,;\n ' } }).status).toBe('needs_auth');
    expect(getBuiltinMcpReadiness(source, { env: { TELEGRAM_API_ID_WORK: '123', TELEGRAM_API_HASH_WORK: 'hash', TELEGRAM_SESSION_STRING_WORK: 'work-session' } }).status).toBe('needs_auth');
  });

  it('resolves named Telegram session files and preserves vault/source/environment precedence', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('telegram-mcp');
    const folderPath = join(root, 'sources', source.slug);
    mkdirSync(join(folderPath, 'sessions'));
    const sessionPath = join(folderPath, 'sessions', 'work');
    writeFileSync(`${sessionPath}.session`, 'existing named Telethon session');
    source.mcp!.env = { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'hash', TELEGRAM_SESSION_NAME_WORK: 'sessions/work' };
    const options = {
      workspaceRootPath: root, sourceFolderPath: folderPath,
      env: { TELEGRAM_SESSION_NAME_WORK: '/unrelated/session', TELEGRAM_SESSION_STRINGS: 'ambient-slot' },
      credential: { TELEGRAM_SESSION_NAME_WORK: '${SOURCE_DIR}/sessions/work', TELEGRAM_SESSION_STRINGS: 'vault-slot' },
    };
    expect(getBuiltinMcpReadiness(source, options).status).toBe('ready');
    expect(buildRuntimeBuiltinMcpConfig(source, options).mcp?.env).toMatchObject({
      TELEGRAM_SESSION_NAME_WORK: sessionPath, TELEGRAM_SESSION_STRINGS: 'vault-slot',
    });
    const fileOptions = { ...options, env: { TELEGRAM_SESSION_NAME_WORK: '/unrelated/session' }, credential: undefined };
    expect(getBuiltinMcpReadiness(source, fileOptions).status).toBe('ready');
    expect(buildRuntimeBuiltinMcpConfig(source, fileOptions).mcp?.env?.TELEGRAM_SESSION_NAME_WORK).toBe(sessionPath);
    const server = new SourceServerBuilder().buildMcpServer(loaded(source), null);
    expect(server).toMatchObject({ type: 'stdio', env: { TELEGRAM_SESSION_NAME_WORK: sessionPath } });
    expect(source.mcp?.env?.TELEGRAM_SESSION_NAME_WORK).toBe('sessions/work');
    source.mcp!.env!.TELEGRAM_SESSION_NAME_WORK = 'sessions/missing';
    expect(getBuiltinMcpReadiness(source, { ...fileOptions, env: {} }).status).toBe('needs_auth');
  });

  it('loads encrypted Telegram pool and named-session records through the credential parser into the server builder', async () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = loaded(config('telegram-mcp'));
    const manager = new SourceCredentialManager();
    const load = spyOn(manager, 'load');
    const sessionVariants: Record<string, string>[] = [
      { TELEGRAM_SESSION_STRINGS: 'vault-slot-one;vault-slot-two' },
      { TELEGRAM_SESSION_STRING_WORK: 'vault-work-session' },
    ];
    try {
      for (const sessions of sessionVariants) {
        const stored = { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'vault-hash', ...sessions };
        load.mockResolvedValue({ value: JSON.stringify(stored) });
        const credential = await manager.getApiCredential(source);
        expect(credential).toEqual(stored);
        expect(isMultiHeaderCredential(credential!)).toBe(true);
        expect(new SourceServerBuilder().buildMcpServer(source, null, credential)).toMatchObject({ type: 'stdio', env: stored });
        expect(JSON.stringify(config(source.config.slug))).not.toContain('vault-');
      }
    } finally {
      load.mockRestore();
    }
  });

  it('gates native Windows servers and Everything on real dependencies', () => {
    ensureBuiltinMcpSources(root, { platform: 'win32', env: {}, fileExists: () => false });
    for (const slug of ['everything-mcp', 'windows-commander', 'windows-mcp']) {
      expect(getBuiltinMcpReadiness(config(slug), { platform: 'linux', env: {} }).status).toBe('unsupported_platform');
      expect(getBuiltinMcpReadiness(config(slug), { platform: 'win32', env: {}, fileExists: () => false }).status).toBe('needs_setup');
      expect(getBuiltinMcpReadiness(config(slug), { platform: 'win32', env: {}, fileExists: () => true }).status).toBe('ready');
    }
    expect(config('everything-mcp').mcp?.command).toBe('bun');
    expect(config('windows-mcp').mcp?.command).toContain('/0.7.1/WindowsMcp.exe');
  });

  it('allows an explicitly remote Windows server to run on a different host', () => {
    ensureBuiltinMcpSources(root, { platform: 'linux', env: {} });
    const source = config('windows-mcp');
    source.mcp = { transport: 'http', url: 'https://windows.example/mcp', authType: 'none' };
    save(source);
    expect(getBuiltinMcpReadiness(source, { platform: 'linux', env: {} }).status).toBe('ready');
    expect(getEnabledBuiltinMcpSourceSlugs(root, { platform: 'linux', env: {} })).toContain('windows-mcp');
  });

  it('uses Mem0 hosted MCP with runtime-only bearer authentication and supports explicit OAuth', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('mem0');
    expect(source.mcp?.url).toBe('https://mcp.mem0.ai/mcp');
    expect(source.connectionStatus).toBe('needs_auth');
    expect(getBuiltinMcpReadiness(source, { env: {} }).status).toBe('needs_auth');
    expect(getBuiltinMcpReadiness(source, { env: { MEM0_API_KEY: 'memory-key' } }).status).toBe('ready');
    const runtime = buildRuntimeBuiltinMcpConfig(source, { env: { MEM0_API_KEY: 'memory-key' } });
    expect(runtime.mcp?.headers).toEqual({ Authorization: 'Bearer memory-key' });
    expect(source.mcp?.headers).toBeUndefined();
    source.isAuthenticated = true;
    const built = new SourceServerBuilder().buildMcpServer(loaded(source), 'encrypted-key');
    expect(built).toMatchObject({ type: 'http', headers: { Authorization: 'Bearer encrypted-key' } });
    expect(new SourceCredentialManager().getCredentialId(loaded(source)).type).toBe('source_bearer');
    source.mcp!.authType = 'oauth';
    expect(new SourceCredentialManager().getCredentialId(loaded(source)).type).toBe('source_oauth');
    expect(getBuiltinMcpReadiness(source, { env: {} }).status).toBe('ready');
    expect(buildRuntimeBuiltinMcpConfig(source, { env: { MEM0_API_KEY: 'ignored-key' } }).mcp?.headers).toBeUndefined();
    expect(JSON.stringify(config('mem0'))).not.toContain('memory-key');
  });

  it('recognizes Mem0 keys from the process environment before the background handshake', async () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const previous = process.env.MEM0_API_KEY;
    try {
      delete process.env.MEM0_API_KEY;
      expect(sourceNeedsAuthentication(loaded(config('mem0')))).toBe(true);
      process.env.MEM0_API_KEY = 'environment-memory-key';
      expect(sourceNeedsAuthentication(loaded(config('mem0')))).toBe(false);
      const all = await new SourceServerBuilder().buildAll([{ source: loaded(config('mem0')) }]);
      expect(all.mcpServers.mem0).toMatchObject({ type: 'http', headers: { Authorization: 'Bearer environment-memory-key' } });
      expect(config('mem0').isAuthenticated).toBe(false);
      const source = config('mem0');
      source.isAuthenticated = true;
      expect(new SourceServerBuilder().buildMcpServer(loaded(source), null)).toMatchObject({
        type: 'http', headers: { Authorization: 'Bearer environment-memory-key' },
      });
    } finally {
      if (previous === undefined) delete process.env.MEM0_API_KEY;
      else process.env.MEM0_API_KEY = previous;
    }
  });

  it('requires a real Weaviate endpoint and joins URLs without repeating /v1/mcp', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('weaviate');
    expect(getBuiltinMcpReadiness(source, { env: {} }).status).toBe('needs_setup');
    for (const base of ['https://knowledge.example/', 'https://knowledge.example/v1/', 'https://knowledge.example/v1/mcp/']) {
      const env = { WEAVIATE_URL: base, WEAVIATE_API_KEY: 'weaviate-key' };
      expect(getBuiltinMcpReadiness(source, { env }).status).toBe('ready');
      expect(buildRuntimeBuiltinMcpConfig(source, { env }).mcp).toMatchObject({
        url: 'https://knowledge.example/v1/mcp', headers: { Authorization: 'Bearer weaviate-key' },
      });
    }
    expect(getBuiltinMcpReadiness(source, { env: { WEAVIATE_URL: 'not a URL' } }).status).toBe('needs_setup');
    expect(getBuiltinMcpReadiness(source, { env: { WEAVIATE_URL: 'https://user:secret@knowledge.example' } }).status).toBe('needs_setup');
    source.mcp!.url = 'https://custom.example/proxy/mcp';
    expect(buildRuntimeBuiltinMcpConfig(source, { env: { WEAVIATE_URL: 'https://ignored.example' }, token: 'encrypted-weaviate' }).mcp).toMatchObject({
      url: 'https://custom.example/proxy/mcp', headers: { Authorization: 'Bearer encrypted-weaviate' },
    });
    expect(config('weaviate').mcp?.headers).toBeUndefined();
  });

  it('starts Qdrant locally and omits its file-locked local path for remote overrides', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('qdrant');
    expect(getBuiltinMcpReadiness(source, { env: {} }).status).toBe('ready');
    expect(source.mcp?.args).toEqual(['--from', 'mcp-server-qdrant==0.8.1', 'mcp-server-qdrant', '--transport', 'stdio']);
    expect(source.mcp?.env?.EMBEDDING_MODEL).toBe('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2');
    const server = new SourceServerBuilder().buildMcpServer(loaded(source), null);
    expect(server).toMatchObject({ type: 'stdio', env: {
      QDRANT_LOCAL_PATH: join(root, 'sources', 'qdrant', 'storage'),
      FASTEMBED_CACHE_PATH: join(root, 'sources', 'qdrant', 'embedding-cache'),
    } });
    const runtime = buildRuntimeBuiltinMcpConfig(source, { env: { QDRANT_URL: 'https://vectors.example', QDRANT_API_KEY: 'vector-key' } });
    expect(runtime.mcp?.env?.QDRANT_LOCAL_PATH).toBeUndefined();
    expect(runtime.mcp?.env?.QDRANT_URL).toBe('https://vectors.example');
    expect(runtime.mcp?.env?.QDRANT_API_KEY).toBe('vector-key');
    expect(source.mcp?.env?.QDRANT_LOCAL_PATH).toBe('${SOURCE_DIR}/storage');
    expect(getBuiltinMcpReadiness(source, { env: { QDRANT_API_KEY: 'vector-key' } }).status).toBe('needs_setup');
    expect(JSON.stringify(config('qdrant'))).not.toContain('vector-key');
    source.mcp!.env!.QDRANT_LOCAL_PATH = '/chosen/local-database';
    const globalRemote = { env: { QDRANT_URL: 'https://unrelated.example', QDRANT_API_KEY: 'unrelated-key' } };
    expect(getBuiltinMcpReadiness(source, globalRemote).status).toBe('ready');
    expect(buildRuntimeBuiltinMcpConfig(source, globalRemote).mcp?.env).toMatchObject({ QDRANT_LOCAL_PATH: '/chosen/local-database' });
    expect(buildRuntimeBuiltinMcpConfig(source, globalRemote).mcp?.env?.QDRANT_URL).toBeUndefined();
    expect(buildRuntimeBuiltinMcpConfig(source, globalRemote).mcp?.env?.QDRANT_API_KEY).toBeUndefined();
    source.mcp!.env!.QDRANT_URL = 'https://chosen.example';
    expect(buildRuntimeBuiltinMcpConfig(source, globalRemote).mcp?.env?.QDRANT_LOCAL_PATH).toBeUndefined();
    expect(buildRuntimeBuiltinMcpConfig(source, globalRemote).mcp?.env?.QDRANT_URL).toBe('https://chosen.example');
  });

  it('keeps the owned QMD index inside its source even with an unrelated inherited index path', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('qmd');
    const original = process.env.INDEX_PATH;
    try {
      process.env.INDEX_PATH = '/unrelated/index.sqlite';
      const server = new SourceServerBuilder().buildMcpServer(loaded(source), null);
      expect(server).toMatchObject({ type: 'stdio', env: { INDEX_PATH: join(root, 'sources', 'qmd', 'cache', 'qmd', 'rox.sqlite') } });
      expect(source.mcp?.env?.INDEX_PATH).toBeUndefined();
      source.mcp!.env!.INDEX_PATH = '/chosen/custom.sqlite';
      expect(buildRuntimeBuiltinMcpConfig(source).mcp?.env?.INDEX_PATH).toBe('/chosen/custom.sqlite');
    } finally {
      if (original === undefined) delete process.env.INDEX_PATH;
      else process.env.INDEX_PATH = original;
    }
  });

  it('reports local account authentication requirements while respecting vault hints', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    const source = config('telegram-mcp');
    expect(sourceNeedsAuthentication(loaded(source))).toBe(true);
    source.isAuthenticated = true;
    expect(sourceNeedsAuthentication(loaded(source))).toBe(false);
  });

  it('saving credentials does not mark managed MCP servers connected before a handshake', () => {
    ensureBuiltinMcpSources(root, { env: {} });
    expect(markSourceAuthenticated(root, 'firecrawl-mcp')).toBe(true);
    expect(config('firecrawl-mcp').isAuthenticated).toBe(true);
    expect(config('firecrawl-mcp').connectionStatus).toBe('untested');
  });

  it('returns useful launch errors instead of spawning incompatible servers', async () => {
    ensureBuiltinMcpSources(root, { platform: 'linux', env: {} });
    const result = await new SourceServerBuilder().buildAll([{ source: loaded(config('windows-mcp')) }]);
    if (process.platform !== 'win32') {
      expect(result.mcpServers).toEqual({});
      expect(result.errors[0]?.error).toContain('Windows');
    }
  });
});
