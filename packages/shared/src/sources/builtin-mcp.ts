/**
 * Default MCP catalog. Seeding creates configuration, not a successful connection:
 * only the MCP handshake may promote a source to `connected`.
 *
 * Commands are pinned to the upstream packages checked when this catalog was
 * introduced. Telegram deliberately uses the upstream Git repository: the PyPI
 * package named telegram-mcp belongs to a different project.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import type { FolderSourceConfig, McpSourceConfig } from './types.ts';
import { expandVars } from '../utils/paths.ts';
import { ensureBuiltinQmdCollection } from './builtin-mcp-qmd.ts';

// A valid reserved placeholder keeps an incomplete source schema-valid. It is
// never contacted: readiness requires the real WEAVIATE_URL or a user endpoint.
const WEAVIATE_MCP_URL = 'https://weaviate.invalid/v1/mcp';

export interface BuiltinMcpSpec {
  slug: string;
  name: string;
  repository: string;
  usage: string;
  icon: string;
  mcp: McpSourceConfig;
  platforms?: readonly string[];
  runtime?: { runner: 'npx' | 'uvx' | 'bun'; package: string };
  requiredEnvironment?: readonly string[];
  setup?: string;
}

export const BUILTIN_MCP_CATALOG: readonly BuiltinMcpSpec[] = [
  {
    slug: 'deepwiki', name: 'DeepWiki', icon: '📚',
    repository: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    usage: 'Read repository architecture and ask questions about public GitHub repositories before changing unfamiliar code.',
    mcp: { transport: 'http', url: 'https://mcp.deepwiki.com/mcp', authType: 'none' },
  },
  {
    slug: 'context7', name: 'Context7', icon: '📖',
    repository: 'https://github.com/upstash/context7',
    usage: 'Resolve library IDs and fetch current, version-specific API documentation before writing integrations, configuration, or library-dependent code.',
    mcp: { transport: 'http', url: 'https://mcp.context7.com/mcp', authType: 'none' },
    setup: 'Public access works without a key. CONTEXT7_API_KEY optionally increases limits; keep it in the environment or encrypted source credentials.',
  },
  {
    slug: 'firecrawl-mcp', name: 'Firecrawl MCP', icon: '🔥',
    repository: 'https://github.com/firecrawl/firecrawl-mcp-server',
    usage: 'Search, map, scrape and crawl websites when research needs page content and evidence.',
    runtime: { runner: 'npx', package: 'firecrawl-mcp@3.27.3' },
    requiredEnvironment: ['FIRECRAWL_API_KEY'],
    mcp: { transport: 'stdio', command: 'npx', args: ['-y', 'firecrawl-mcp@3.27.3'], authType: 'none', platform: { win32: { command: 'npx.cmd' } } },
    setup: 'Requires Node.js 22+ and FIRECRAWL_API_KEY (CRAFT_FIRECRAWL_API_KEY and ROX_FIRECRAWL_API_KEY are also accepted). The existing Firecrawl API source is preserved.',
  },
  {
    slug: 'playwright', name: 'Playwright', icon: '🌐',
    repository: 'https://github.com/microsoft/playwright-mcp',
    usage: 'Use a real browser to navigate, inspect pages, reproduce UI issues and verify user-facing behavior.',
    runtime: { runner: 'npx', package: '@playwright/mcp@0.0.83' },
    mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--browser', 'chromium', '--headless'], authType: 'none', platform: { win32: { command: 'npx.cmd' } } },
    setup: 'Requires Node.js 18+. The application installs Chromium through the server browser installation tool during startup.',
  },
  {
    slug: 'telegram-mcp', name: 'Telegram MCP', icon: '✈️',
    repository: 'https://github.com/chigwell/telegram-mcp',
    usage: 'Read Telegram context when the task calls for it. Send or change messages only when the user authorizes those actions.',
    runtime: { runner: 'uvx', package: 'git+https://github.com/chigwell/telegram-mcp@81ad14bd076d17babd8be2425965235b0c6b9e26' },
    requiredEnvironment: ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION_STRING'],
    mcp: { transport: 'stdio', command: 'uvx', args: ['--from', 'git+https://github.com/chigwell/telegram-mcp@81ad14bd076d17babd8be2425965235b0c6b9e26', 'telegram-mcp'], authType: 'none', headerNames: ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION_STRING'] },
    setup: 'Requires uv, Git, Python 3.10+, TELEGRAM_API_ID, TELEGRAM_API_HASH and an authorized TELEGRAM_SESSION_STRING or existing TELEGRAM_SESSION_NAME file. Obtain API credentials at https://my.telegram.org and generate the session using the upstream login helper. Never install the unrelated PyPI telegram-mcp package.',
  },
  {
    slug: 'codegraph', name: 'CodeGraphContext', icon: '🕸️',
    repository: 'https://github.com/CodeGraphContext/CodeGraphContext',
    usage: 'Index the selected project, inspect symbols, call chains and dependencies, and assess the impact of changes.',
    runtime: { runner: 'uvx', package: 'codegraphcontext==0.6.13' },
    mcp: {
      transport: 'stdio', command: 'uvx', args: ['--from', 'codegraphcontext==0.6.13', 'codegraphcontext', 'mcp', 'start'], authType: 'none',
      env: { CGC_RUNTIME_DB_TYPE: 'ladybugdb', CGC_RUNTIME_DB_PATH: '${SOURCE_DIR}/graph-db', CGC_EMBEDDED_BUFFER_POOL_MB: '256' },
    },
    setup: 'Requires uv and Python 3.10+. Uses a workspace-local embedded LadybugDB with a 256 MiB buffer pool; index the project through MCP before asking graph questions.',
  },
  {
    slug: 'qmd', name: 'QMD', icon: '📝',
    repository: 'https://github.com/tobi/qmd',
    usage: 'Find relevant local Markdown notes and documents using keyword or semantic retrieval, then read the matching documents before answering.',
    runtime: { runner: 'npx', package: '@tobilu/qmd@2.8.3' },
    mcp: {
      transport: 'stdio', command: 'npx', args: ['-y', '@tobilu/qmd@2.8.3', 'mcp', '--index', 'rox'], authType: 'none',
      platform: { win32: { command: 'npx.cmd' } },
      env: { QMD_CONFIG_DIR: '${SOURCE_DIR}/config', XDG_CACHE_HOME: '${SOURCE_DIR}/cache' },
    },
    setup: 'Requires Node.js 22+. The application creates a workspace-local index of the enabled local Notes vault, or an empty documents folder beside this source, and updates its keyword index at startup. It never indexes the application workspace root. To add another document folder, use the pinned QMD CLI collection add command with --index rox and these same environment paths. Run update after changing documents. Keyword queries need no models; semantic search and reranking download local GGUF models on first use.',
  },
  {
    slug: 'weaviate', name: 'Weaviate', icon: '🔍',
    repository: 'https://docs.weaviate.io/weaviate/configuration/mcp-server',
    usage: 'Retrieve relevant objects from the configured Weaviate knowledge collections. Store or change objects only when the task calls for it and the server exposes write tools.',
    mcp: { transport: 'http', url: WEAVIATE_MCP_URL, authType: 'none' },
    setup: 'Uses the MCP built into Weaviate 1.37.1+ (generally available from 1.38), not the deprecated standalone MCP wrapper. Set WEAVIATE_URL to the existing database URL, or configure mcp.url as its /v1/mcp endpoint. Enable MCP_SERVER_ENABLED=true on the database. WEAVIATE_API_KEY or an encrypted source token provides optional Bearer authentication. Write access requires the separate MCP_SERVER_WRITE_ACCESS_ENABLED=true server setting. A Weaviate database must be running; this connector does not create a database or cloud account.',
  },
  {
    slug: 'qdrant', name: 'Qdrant', icon: '🧭',
    repository: 'https://github.com/qdrant/mcp-server-qdrant',
    usage: 'Store and retrieve task-relevant knowledge in the selected Qdrant vector collection. Keep records scoped to the user or project and use the collection chosen for the task.',
    runtime: { runner: 'uvx', package: 'mcp-server-qdrant==0.8.1' },
    mcp: {
      transport: 'stdio', command: 'uvx', args: ['--from', 'mcp-server-qdrant==0.8.1', 'mcp-server-qdrant', '--transport', 'stdio'], authType: 'none',
      env: {
        QDRANT_LOCAL_PATH: '${SOURCE_DIR}/storage', COLLECTION_NAME: 'rox-memory',
        EMBEDDING_MODEL: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', FASTEMBED_CACHE_PATH: '${SOURCE_DIR}/embedding-cache',
      },
    },
    setup: 'Requires uv and Python 3.10+. Defaults to a persistent, workspace-local Qdrant database and multilingual FastEmbed embeddings (including Russian), without a separate database service or API key. The approximately 220 MB embedding model downloads into a persistent source-local cache on first use. Local database connections are shared within the application so concurrent chats do not compete for its file lock. To connect an existing server, set QDRANT_URL and optionally QDRANT_API_KEY; the local path is then omitted. COLLECTION_NAME and EMBEDDING_MODEL may also be configured through the source environment.',
  },
  {
    slug: 'mem0', name: 'Mem0', icon: '🧠',
    repository: 'https://docs.mem0.ai/platform/mem0-mcp',
    usage: 'Retrieve and maintain useful long-term preferences, decisions and context for the current user. Respect the user\'s memory preferences and avoid storing the same facts in every connected memory system.',
    requiredEnvironment: ['MEM0_API_KEY'],
    mcp: { transport: 'http', url: 'https://mcp.mem0.ai/mcp', authType: 'bearer' },
    setup: 'Uses the current official hosted MCP, not the archived mem0-mcp-server package. Set MEM0_API_KEY or save an encrypted source token; obtain a key at https://app.mem0.ai/dashboard/api-keys. An existing Mem0 account is required. The hosted server also supports OAuth when the source is explicitly configured for OAuth. Memories are stored by the configured Mem0 service.',
  },
  {
    slug: 'everything-mcp', name: 'Everything MCP', icon: '🔎',
    repository: 'https://github.com/danielsimonjr/everything-mcp',
    usage: 'Search Windows files and folders by name or pattern and obtain metadata for known paths.',
    platforms: ['win32'], runtime: { runner: 'bun', package: '@danielsimonjr/everything-mcp@3.2.0' },
    mcp: { transport: 'stdio', command: 'bun', args: ['x', '@danielsimonjr/everything-mcp@3.2.0'], authType: 'none', env: { ES_PATH: '${CRAFT_CONFIG_DIR}/mcp-binaries/everything-cli/1.1.0.38/es.exe' } },
    setup: 'Windows only. The application installs the Everything es.exe CLI. Requires Bun and an existing running Everything desktop service. ES_PATH can override the managed command-line tool.',
  },
  {
    slug: 'windows-commander', name: 'Windows Commander MCP', icon: '🪟',
    repository: 'https://github.com/exalsch/windows-commander-mcp',
    usage: 'Inspect and control Windows desktop applications, windows and system state for tasks involving the local machine.',
    platforms: ['win32'],
    mcp: { transport: 'stdio', command: '${CRAFT_CONFIG_DIR}/mcp-binaries/windows-commander/0.1.1/WindowsCommander.McpServer.exe', args: [], authType: 'none' },
    setup: 'Windows only. The application installs the verified upstream release into its managed cache. ROX_WINDOWS_COMMANDER_MCP_PATH can override WindowsCommander.McpServer.exe. The upstream local confirmation defaults remain in effect.',
  },
  {
    slug: 'windows-mcp', name: 'Windows MCP', icon: '🖥️',
    repository: 'https://github.com/danielsimonjr/Windows-MCP',
    usage: 'Inspect and automate Windows desktop UI, files and system state when the task requires native Windows tools.',
    platforms: ['win32'],
    mcp: { transport: 'stdio', command: '${CRAFT_CONFIG_DIR}/mcp-binaries/windows-mcp/0.7.1/WindowsMcp.exe', args: [], authType: 'none' },
    setup: 'Windows only. The application installs the verified upstream C# release into its managed cache. ROX_WINDOWS_MCP_PATH can override WindowsMcp.exe. This fork is not the older Python Windows-MCP package.',
  },
];

/** These upstream projects are skill packs, not MCP server processes. */
export const BUILTIN_AGENT_SKILL_PACKS = [
  { slug: 'superpowers', name: 'Superpowers', repository: 'https://github.com/obra/superpowers' },
  { slug: 'understand-anything', name: 'Understand Anything', repository: 'https://github.com/Egonex-AI/Understand-Anything' },
] as const;

export interface BuiltinMcpOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  /** Only consulted in memory. Never written to the source configuration. */
  token?: string | null;
  credential?: Record<string, string> | null;
  fileExists?: (path: string) => boolean;
}

export type BuiltinMcpReadiness = {
  status: 'ready' | 'disabled' | 'needs_auth' | 'needs_setup' | 'unsupported_platform';
  reason?: string;
};

function specFor(config: FolderSourceConfig): BuiltinMcpSpec | undefined {
  return BUILTIN_MCP_CATALOG.find(spec => spec.slug === config.slug && config.id === `builtin-mcp-${spec.slug}`);
}

function withSelectedPlatform(config: FolderSourceConfig, options: BuiltinMcpOptions): FolderSourceConfig {
  const mcp = config.mcp;
  if (mcp?.transport !== 'stdio') return config;
  const override = mcp.platform?.[(options.platform ?? process.platform) as keyof NonNullable<McpSourceConfig['platform']>];
  if (!override) return config;
  // Resolve the platform layer before injecting credentials or switching
  // Qdrant storage modes. A later merge must not restore the local DB path.
  return { ...config, mcp: { ...mcp,
    command: override.command ?? mcp.command,
    args: override.args ?? mcp.args,
    env: { ...mcp.env, ...override.env },
    platform: undefined,
  } };
}

export function isManagedBuiltinMcpSource(config: FolderSourceConfig): boolean {
  return !!specFor(config);
}

function value(key: string, options: BuiltinMcpOptions, config?: FolderSourceConfig): string | undefined {
  const candidates = [options.credential?.[key], config?.mcp?.env?.[key], (options.env ?? process.env)[key]];
  return candidates.find(candidate => typeof candidate === 'string' && !!candidate.trim() && !candidate.includes('${'))?.trim();
}

function firecrawlKey(config: FolderSourceConfig, options: BuiltinMcpOptions): string | undefined {
  return options.token?.trim() || value('FIRECRAWL_API_KEY', options, config)
    || value('CRAFT_FIRECRAWL_API_KEY', options) || value('ROX_FIRECRAWL_API_KEY', options);
}

function apiKey(config: FolderSourceConfig, options: BuiltinMcpOptions, name: string): string | undefined {
  return options.token?.trim() || value(name, options, config);
}

function hasExplicitQdrantLocalPath(config: FolderSourceConfig): boolean {
  const path = config.mcp?.env?.QDRANT_LOCAL_PATH;
  return !!path?.trim() && path !== '${SOURCE_DIR}/storage';
}

function qdrantUrl(config: FolderSourceConfig, options: BuiltinMcpOptions): string | undefined {
  // A user-selected local path must not be redirected by an unrelated global
  // QDRANT_URL. An explicitly configured URL still switches to remote mode.
  return value('QDRANT_URL', hasExplicitQdrantLocalPath(config) ? { ...options, env: {} } : options, config);
}

function qdrantKey(config: FolderSourceConfig, options: BuiltinMcpOptions): string | undefined {
  return apiKey(config, hasExplicitQdrantLocalPath(config) && !qdrantUrl(config, options) ? { ...options, env: {} } : options, 'QDRANT_API_KEY');
}

function weaviateUrl(config: FolderSourceConfig, options: BuiltinMcpOptions): string | undefined {
  if (config.mcp?.url && config.mcp.url !== WEAVIATE_MCP_URL) return config.mcp.url;
  const base = value('WEAVIATE_URL', options, config);
  if (!base) return undefined;
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (url.username || url.password) return undefined;
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/v1/mcp') ? path : path.endsWith('/v1') ? `${path}/mcp` : `${path}/v1/mcp`;
    return url.toString();
  } catch { return undefined; }
}

function binaryPath(config: FolderSourceConfig, key: string, options: BuiltinMcpOptions): string | undefined {
  const command = config.mcp?.platform?.[(options.platform ?? process.platform) as 'win32']?.command || config.mcp?.command;
  // Preserve explicit user commands. Environment overrides apply to managed paths.
  if (command && !command.includes('${')) return expandVars(command);
  return value(key, options) || (command ? expandVars(command) : undefined);
}

function everythingPath(config: FolderSourceConfig, options: BuiltinMcpOptions): string | undefined {
  const explicit = value('ES_PATH', options, config);
  if (explicit) return explicit;
  const managed = config.mcp?.env?.ES_PATH;
  if (managed) {
    const expanded = expandVars(managed);
    if ((options.fileExists ?? existsSync)(expanded)) return expanded;
  }
  const env = options.env ?? process.env;
  const candidates = [
    win32.join(env.ProgramFiles || 'C:\\Program Files', 'Everything', 'es.exe'),
    ...(env.USERPROFILE ? [win32.join(env.USERPROFILE, 'scoop', 'apps', 'everything', 'current', 'es.exe')] : []),
  ];
  return candidates.find(path => (options.fileExists ?? existsSync)(path));
}

/** Readiness is a launch precondition, not evidence that a server is connected. */
export function getBuiltinMcpReadiness(config: FolderSourceConfig, options: BuiltinMcpOptions = {}): BuiltinMcpReadiness {
  if (!config.enabled) return { status: 'disabled' };
  const spec = specFor(config);
  if (!spec || config.type !== 'mcp') return { status: 'ready' };
  config = withSelectedPlatform(config, options);
  if (config.slug === 'weaviate' && config.mcp?.transport !== 'stdio' && !weaviateUrl(config, options)) {
    return { status: 'needs_setup', reason: 'Set WEAVIATE_URL to a running Weaviate 1.37.1+ database with MCP_SERVER_ENABLED=true, or configure its /v1/mcp endpoint.' };
  }
  if (config.slug === 'mem0' && config.mcp?.url === spec.mcp.url && config.mcp?.authType === 'bearer'
    && !apiKey(config, options, 'MEM0_API_KEY')) {
    return { status: 'needs_auth', reason: 'Set MEM0_API_KEY or add an encrypted Mem0 source token.' };
  }
  // Explicit remote connections can run on a different host from this app.
  if (config.mcp?.transport !== 'stdio') return { status: 'ready' };
  if (spec.platforms && !spec.platforms.includes(options.platform ?? process.platform)) {
    return { status: 'unsupported_platform', reason: 'Available only on Windows.' };
  }
  if (config.slug === 'firecrawl-mcp' && !firecrawlKey(config, options)) {
    return { status: 'needs_auth', reason: 'Set FIRECRAWL_API_KEY or add an encrypted source credential.' };
  }
  if (config.slug === 'telegram-mcp') {
    const missing = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH'].filter(key => !value(key, options, config));
    const sessionName = value('TELEGRAM_SESSION_NAME', options, config);
    const hasSessionFile = sessionName && (options.fileExists ?? existsSync)(sessionName.endsWith('.session') ? sessionName : `${sessionName}.session`);
    if (!value('TELEGRAM_SESSION_STRING', options, config) && !hasSessionFile) missing.push('TELEGRAM_SESSION_STRING or authorized TELEGRAM_SESSION_NAME');
    if (missing.length) return { status: 'needs_auth', reason: `Configure ${missing.join(', ')}.` };
  }
  if (config.slug === 'qdrant' && qdrantKey(config, options) && !qdrantUrl(config, options)) {
    return { status: 'needs_setup', reason: 'Set QDRANT_URL when using QDRANT_API_KEY, or remove the key to use the local database.' };
  }
  if (config.slug === 'everything-mcp') {
    const path = everythingPath(config, options);
    if (!path || !(options.fileExists ?? existsSync)(path)) return { status: 'needs_setup', reason: 'Install Everything and its es.exe command-line tool; set ES_PATH if needed.' };
  }
  if (config.slug === 'windows-commander' || config.slug === 'windows-mcp') {
    const key = config.slug === 'windows-commander' ? 'ROX_WINDOWS_COMMANDER_MCP_PATH' : 'ROX_WINDOWS_MCP_PATH';
    const path = binaryPath(config, key, options);
    if (!path || !(options.fileExists ?? existsSync)(path)) return { status: 'needs_setup', reason: `Install the upstream Windows server and set ${key} to its executable.` };
  }
  return { status: 'ready' };
}

/** Resolve environment secrets and executable paths without mutating disk config. */
export function buildRuntimeBuiltinMcpConfig(config: FolderSourceConfig, options: BuiltinMcpOptions = {}): FolderSourceConfig {
  if (!specFor(config) || !config.mcp) return config;
  config = withSelectedPlatform(config, options);
  const mcp = { ...config.mcp };
  if (config.slug === 'firecrawl-mcp') {
    const key = firecrawlKey(config, options);
    if (key) mcp.env = { ...mcp.env, FIRECRAWL_API_KEY: key };
  } else if (config.slug === 'context7') {
    const key = options.token?.trim() || value('CONTEXT7_API_KEY', options);
    if (key) mcp.headers = { ...mcp.headers, Authorization: `Bearer ${key}` };
  } else if (config.slug === 'telegram-mcp') {
    mcp.env = { ...mcp.env };
    for (const key of ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION_STRING', 'TELEGRAM_SESSION_NAME']) {
      const secret = value(key, options, config);
      if (secret) mcp.env[key] = secret;
    }
  } else if (config.slug === 'qmd' && mcp.transport === 'stdio' && ['npx', 'npx.cmd'].includes(mcp.command || '')
    && JSON.stringify(mcp.args) === JSON.stringify(['-y', '@tobilu/qmd@2.8.3', 'mcp', '--index', 'rox'])
    && mcp.env?.QMD_CONFIG_DIR === '${SOURCE_DIR}/config' && mcp.env?.XDG_CACHE_HOME === '${SOURCE_DIR}/cache'
    && !mcp.env.INDEX_PATH) {
    // QMD's generic INDEX_PATH override otherwise inherits from another
    // process/workspace. Match its normal named-index path in our own cache.
    mcp.env = { ...mcp.env, INDEX_PATH: '${SOURCE_DIR}/cache/qmd/rox.sqlite' };
  } else if (config.slug === 'weaviate' && mcp.transport !== 'stdio') {
    const url = weaviateUrl(config, options);
    if (url) mcp.url = url;
    const key = apiKey(config, options, 'WEAVIATE_API_KEY');
    if (key && mcp.authType !== 'oauth') {
      mcp.headers = { ...mcp.headers, Authorization: `Bearer ${key}` };
      mcp.authType = 'none'; // Authentication is already supplied by this header.
    }
  } else if (config.slug === 'mem0' && mcp.transport !== 'stdio' && mcp.authType === 'bearer') {
    const key = apiKey(config, options, 'MEM0_API_KEY');
    if (key) {
      mcp.headers = { ...mcp.headers, Authorization: `Bearer ${key}` };
      mcp.authType = 'none';
    }
  } else if (config.slug === 'qdrant' && mcp.transport === 'stdio') {
    mcp.env = { ...mcp.env };
    for (const key of ['COLLECTION_NAME', 'EMBEDDING_MODEL', 'QDRANT_LOCAL_PATH', 'FASTEMBED_CACHE_PATH']) {
      const setting = value(key, options, config);
      if (setting) mcp.env[key] = setting;
    }
    const url = qdrantUrl(config, options);
    if (url) {
      mcp.env.QDRANT_URL = url;
      const key = qdrantKey(config, options);
      if (key) mcp.env.QDRANT_API_KEY = key;
      delete mcp.env.QDRANT_LOCAL_PATH;
    } else {
      delete mcp.env.QDRANT_URL;
      delete mcp.env.QDRANT_API_KEY;
    }
  } else if (config.slug === 'everything-mcp') {
    const path = everythingPath(config, options);
    if (path) mcp.env = { ...mcp.env, ES_PATH: path };
  } else if (config.slug === 'windows-commander' || config.slug === 'windows-mcp') {
    const key = config.slug === 'windows-commander' ? 'ROX_WINDOWS_COMMANDER_MCP_PATH' : 'ROX_WINDOWS_MCP_PATH';
    const path = binaryPath(config, key, options);
    if (path) mcp.command = path;
  }
  return { ...config, mcp };
}

function guideFor(spec: BuiltinMcpSpec): string {
  return `# ${spec.name}\n\n${spec.usage}\n\n## Setup\n\n${spec.setup || 'Public remote MCP server; no credentials required.'}\n\nUpstream: ${spec.repository}\n\n## Guidelines\n\nUse this source whenever it fits the task. Prefer its structured tools over guessing APIs or relying on stale knowledge. Read tool results before drawing conclusions. If the source is unavailable, report the actual setup or connection issue and use an available alternative. Configuration alone does not prove a successful connection. Keep API keys and account sessions in environment variables or encrypted source credentials, never in config.json.\n`;
}

/** Seed absent sources only. Existing user edits and disabled sources are authoritative. */
export function ensureBuiltinMcpSources(workspaceRootPath: string, options: BuiltinMcpOptions = {}): { created: string[] } {
  const created: string[] = [];
  const now = Date.now();
  for (const spec of BUILTIN_MCP_CATALOG) {
    const dir = join(workspaceRootPath, 'sources', spec.slug);
    const path = join(dir, 'config.json');
    if (existsSync(path)) continue;
    const config: FolderSourceConfig = {
      id: `builtin-mcp-${spec.slug}`, slug: spec.slug, name: spec.name,
      enabled: true, provider: spec.slug, type: 'mcp', mcp: spec.mcp,
      tagline: spec.usage, icon: spec.icon, isAuthenticated: false,
      connectionStatus: 'untested', createdAt: now, updatedAt: now,
    };
    const readiness = getBuiltinMcpReadiness(config, options);
    if (readiness.status === 'needs_auth') config.connectionStatus = 'needs_auth';
    else if (readiness.status === 'unsupported_platform') config.connectionStatus = 'local_disabled';
    if (readiness.reason) config.connectionError = readiness.reason;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
    const guidePath = join(dir, 'guide.md');
    if (!existsSync(guidePath)) writeFileSync(guidePath, guideFor(spec), 'utf-8');
    created.push(spec.slug);
  }
  try {
    const config = JSON.parse(readFileSync(join(workspaceRootPath, 'sources', 'qmd', 'config.json'), 'utf-8')) as FolderSourceConfig;
    ensureBuiltinQmdCollection(workspaceRootPath, config);
  } catch { /* Invalid/custom QMD configuration is handled by normal source loading. */ }
  return { created };
}

/** Select real persisted sources; never resurrect a deleted or disabled template. */
export function getDefaultMcpSourceSlugs(workspaceRootPath: string, options: BuiltinMcpOptions = {}): string[] {
  const slugs: string[] = [];
  for (const spec of BUILTIN_MCP_CATALOG) {
    try {
      const config = JSON.parse(readFileSync(join(workspaceRootPath, 'sources', spec.slug, 'config.json'), 'utf-8')) as FolderSourceConfig;
      const readiness = getBuiltinMcpReadiness(config, options);
      // Authentication metadata can signal encrypted credentials. The server
      // builder still checks the real loaded secret before launching.
      const storedAuth = readiness.status === 'needs_auth' && config.isAuthenticated === true;
      if (config.enabled && config.slug === spec.slug && config.type === 'mcp' && (readiness.status === 'ready' || storedAuth)) slugs.push(spec.slug);
    } catch { /* Missing or invalid configs are handled by normal source loading. */ }
  }
  return slugs;
}

/** Include pending supported servers so the session can adopt them after setup. */
export function getEnabledBuiltinMcpSourceSlugs(workspaceRootPath: string, options: BuiltinMcpOptions = {}): string[] {
  const slugs: string[] = [];
  for (const spec of BUILTIN_MCP_CATALOG) {
    try {
      const config = JSON.parse(readFileSync(join(workspaceRootPath, 'sources', spec.slug, 'config.json'), 'utf-8')) as FolderSourceConfig;
      if (config.enabled && config.slug === spec.slug && config.type === 'mcp'
        && getBuiltinMcpReadiness(config, options).status !== 'unsupported_platform') slugs.push(spec.slug);
    } catch { /* Missing or invalid configs are handled by normal source loading. */ }
  }
  return slugs;
}
