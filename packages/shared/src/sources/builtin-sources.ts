/**
 * Built-in Sources
 *
 * Bundled API source templates (Exa, Firecrawl, Brave Search and E2B) are seeded into
 * new workspaces under sources/{slug}/ so the normal UI/list path picks them up.
 * They are enabled by default; credentials come from server env
 * a private backend secret file or environment, and never enter source configs.
 *
 * craft-agents-docs remains an always-available MCP server configured in
 * craft-agent.ts, not a folder source.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FolderSourceConfig, LoadedSource } from './types.ts';
import { toPortablePath } from '../utils/paths.ts';
import { getServerServiceKey, SERVER_SERVICE_KEYS, type ServerServiceKey } from '../config/server-services.ts';
import { estimateTokens } from '../utils/large-response.ts';

function sourcesDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'sources');
}

export const BUILTIN_SOURCE_SLUGS = ['exa', 'firecrawl', 'brave', 'e2b'] as const;
export type BuiltinSourceSlug = (typeof BUILTIN_SOURCE_SLUGS)[number];

const EXA_ENV_KEYS = ['EXA_API_KEY', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY'] as const;
const FIRECRAWL_ENV_KEYS = [
  'FIRECRAWL_API_KEY',
  'CRAFT_FIRECRAWL_API_KEY',
  'ROX_FIRECRAWL_API_KEY',
] as const;

function firstEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const canonical = keys.find((key) => (SERVER_SERVICE_KEYS as readonly string[]).includes(key));
  return canonical ? getServerServiceKey(canonical as ServerServiceKey) : undefined;
}

export function hasExaKey(): boolean {
  return !!firstEnv(EXA_ENV_KEYS);
}

export function hasFirecrawlKey(): boolean {
  return !!firstEnv(FIRECRAWL_ENV_KEYS);
}

function buildExaConfig(now: number): FolderSourceConfig {
  const keyed = hasExaKey();
  return {
    id: 'builtin-exa',
    name: 'Exa',
    slug: 'exa',
    enabled: true,
    provider: 'exa',
    type: 'api',
    api: {
      baseUrl: 'https://api.exa.ai',
      authType: 'header',
      headerName: 'x-api-key',
      testEndpoint: { method: 'POST', path: '/search', body: { query: 'test', numResults: 1 } },
    },
    tagline: 'Neural web search & research (Exa)',
    icon: '🔎',
    isAuthenticated: keyed,
    connectionStatus: keyed ? 'connected' : 'needs_auth',
    createdAt: now,
    updatedAt: now,
  };
}

function buildFirecrawlConfig(now: number): FolderSourceConfig {
  const keyed = hasFirecrawlKey();
  return {
    id: 'builtin-firecrawl',
    name: 'Firecrawl',
    slug: 'firecrawl',
    enabled: true,
    provider: 'firecrawl',
    type: 'api',
    api: {
      baseUrl: 'https://api.firecrawl.dev',
      authType: 'bearer',
      testEndpoint: { method: 'GET', path: '/v1/team/credit-usage' },
    },
    tagline: 'Crawl & extract clean page content (Firecrawl)',
    icon: '🔥',
    isAuthenticated: keyed,
    connectionStatus: keyed ? 'connected' : 'needs_auth',
    createdAt: now,
    updatedAt: now,
  };
}

const SERVICE_ENV: Record<BuiltinSourceSlug, readonly string[]> = {
  exa: EXA_ENV_KEYS,
  firecrawl: FIRECRAWL_ENV_KEYS,
  brave: ['BRAVE_API_KEY', 'ROX_BRAVE_API_KEY'],
  e2b: ['E2B_API_KEY', 'ROX_E2B_API_KEY'],
}
const SERVICE_ORIGINS: Record<BuiltinSourceSlug, string> = {
  exa: 'https://api.exa.ai', firecrawl: 'https://api.firecrawl.dev',
  brave: 'https://api.search.brave.com', e2b: 'https://api.e2b.dev',
}
const SERVICE_HEADERS: Partial<Record<BuiltinSourceSlug, string>> = {
  exa: 'x-api-key', brave: 'X-Subscription-Token', e2b: 'X-API-Key',
}

/** Server-side shared credential, restricted to the bundled provider's own origin and header. */
export function isManagedBuiltinSource(config: FolderSourceConfig): boolean {
  const slug = config.slug as BuiltinSourceSlug
  if (!BUILTIN_SOURCE_SLUGS.includes(slug) || config.id !== `builtin-${slug}`) return false
  return config.type === 'api' && config.provider === slug
    && config.api?.baseUrl === SERVICE_ORIGINS[slug]
    && config.api?.authType === (slug === 'firecrawl' ? 'bearer' : 'header')
    && config.api?.headerName === SERVICE_HEADERS[slug]
    && !config.api?.headerNames?.length
    && !config.api?.renewEndpoint && !config.api?.oauth
    && (config.api?.authScheme === undefined || config.api.authScheme === 'Bearer')
}

export function getBuiltinSourceCredential(source: Pick<LoadedSource, 'config'>): string | undefined {
  if (!isManagedBuiltinSource(source.config)) return undefined
  return firstEnv(SERVICE_ENV[source.config.slug as BuiltinSourceSlug])
}

/** Reconcile availability on every load, including workspaces created before provisioning. */
export function applyBuiltinSourceAvailability(config: FolderSourceConfig): FolderSourceConfig {
  if (!getBuiltinSourceCredential({ config })) return config
  if (config.connectionStatus === 'failed') return { ...config, isAuthenticated: true }
  return { ...config, isAuthenticated: true, connectionStatus: 'connected', connectionError: undefined }
}

function buildBuiltinConfig(slug: BuiltinSourceSlug, now: number): FolderSourceConfig {
  if (slug === 'exa') return buildExaConfig(now)
  if (slug === 'firecrawl') return buildFirecrawlConfig(now)
  const keyed = !!firstEnv(SERVICE_ENV[slug])
  const brave = slug === 'brave'
  return {
    id: `builtin-${slug}`, name: brave ? 'Brave Search' : 'E2B', slug, provider: slug, type: 'api', enabled: true,
    api: {
      baseUrl: brave ? 'https://api.search.brave.com' : 'https://api.e2b.dev',
      authType: 'header', headerName: brave ? 'X-Subscription-Token' : 'X-API-Key',
      testEndpoint: { method: 'GET', path: brave ? '/res/v1/web/search?q=Rox&count=1' : '/v2/sandboxes' },
    },
    icon: brave ? '🌐' : '🧪', tagline: brave ? 'Web search with cited results' : 'Isolated code execution sandboxes',
    isAuthenticated: keyed, connectionStatus: keyed ? 'connected' : 'needs_auth', createdAt: now, updatedAt: now,
  }
}

const GUIDES: Record<BuiltinSourceSlug, string> = {
  brave: `# Brave Search

Search the web with GET /res/v1/web/search?q={query}&count=10. Cite original result URLs.
The host supplies BRAVE_API_KEY through X-Subscription-Token; never ask the user for the shared key.
`,
  e2b: `# E2B

Use execute_code for Python or JavaScript code: the host creates a code-interpreter-v1 sandbox, executes code and cleans up automatically.
For management, POST /v2/sandboxes (templateID: code-interpreter-v1, timeout in seconds).
List active environments with GET /v2/sandboxes, inspect GET /sandboxes/{sandboxID}, and delete with DELETE /sandboxes/{sandboxID}.
The host supplies E2B_API_KEY through X-API-Key; never expose this key in code or results.
`,
  exa: `---
description: Exa neural search
---

# Exa

Веб-поиск и research через [Exa](https://exa.ai).

## Auth

Хост автоматически подставляет общий серверный ключ через x-api-key.
Не запрашивай и не показывай общий ключ пользователю. Если хост не настроен,
сообщи, что администратору нужно подключить Exa на сервере.

## Типовые вызовы

- \`POST /search\` — neural / keyword search
- \`POST /contents\` — получить содержимое URL
- \`POST /findSimilar\` — похожие страницы

Используй для research-сессий и сбора источников. Не дублируй сырой HTML —
предпочитай summary + ссылки.
`,
  firecrawl: `---
description: Firecrawl page crawl
---

# Firecrawl

Краулинг и очистка веб-страниц через [Firecrawl](https://firecrawl.dev).

## Auth

Хост автоматически подставляет общий серверный ключ через Bearer.
Не запрашивай и не показывай общий ключ пользователю. Если хост не настроен,
сообщи, что администратору нужно подключить Firecrawl на сервере.

## Типовые вызовы

- \`POST /v2/scrape\` — одна страница → markdown
- \`POST /v2/crawl\` — сайт / раздел
- \`POST /v2/map\` — карта URL

Используй когда нужен чистый текст страницы, а не SERP-сниппеты.
`,
};

function writeSourceFolder(
  workspaceRootPath: string,
  config: FolderSourceConfig,
  guide: string,
): void {
  const dir = join(sourcesDir(workspaceRootPath), config.slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const configPath = join(dir, 'config.json');
  const guidePath = join(dir, 'guide.md');
  // Never overwrite user-edited configs.
  if (!existsSync(configPath)) {
    // Backend availability is computed on read, so removing a shared key cannot
    // leave a persisted authenticated badge behind. User-owned credentials keep
    // their normal saved authentication state.
    const stored = isManagedBuiltinSource(config)
      ? { ...config, isAuthenticated: false, connectionStatus: 'needs_auth' }
      : config;
    writeFileSync(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf-8');
  }
  if (!existsSync(guidePath)) {
    writeFileSync(guidePath, guide, 'utf-8');
  }
}

function buildNotesSourceGuide(notesPath: string): string {
  return `# Notes vault

Workspace markdown notes live at:

${notesPath}

## Scope

Use this source when the user asks you to use their notes as context, search personal/work knowledge, update markdown notes, or create new notes.

## Guidelines

- Notes are plain markdown files under the path above.
- Use file tools to read, search, create, rename, and update notes in that folder.
- Preserve wiki links such as [[Note name]], markdown links, tags, YAML frontmatter, and asset references.
- Assets are stored under ${join(notesPath, 'assets')}.
- Daily notes are stored under ${join(notesPath, 'daily')}.
- When you mention a note in chat, prefer [[Note name]] or notes/path/to/note.md so the UI can open it directly.

## Context

This source is maintained automatically from the built-in Notes feature. It has no external API or authentication.
`;
}

/**
 * Create the generated local Notes source only when its config is absent.
 * An existing source config, including a disabled or custom one, is authoritative.
 */
export function ensureLocalNotesSource(workspaceRootPath: string, notesPath: string): void {
  const configPath = join(sourcesDir(workspaceRootPath), 'notes', 'config.json');
  if (existsSync(configPath)) return;

  mkdirSync(notesPath, { recursive: true });
  const now = Date.now();
  writeSourceFolder(workspaceRootPath, {
    id: 'notes-vault',
    name: 'Notes vault',
    slug: 'notes',
    enabled: true,
    provider: 'craft-notes',
    type: 'local',
    local: {
      path: toPortablePath(notesPath),
      format: 'craft-markdown',
    },
    icon: '📓',
    tagline: 'Markdown notes, backlinks, tags, properties, daily notes, and assets',
    isAuthenticated: true,
    connectionStatus: 'connected',
    createdAt: now,
    updatedAt: now,
  }, buildNotesSourceGuide(notesPath));
}

/**
 * Seed managed services and migrate the old disabled template defaults once.
 * Edited/disabled user configurations remain authoritative after migration.
 */
export function ensureBuiltinSources(workspaceRootPath: string): {
  created: BuiltinSourceSlug[];
  defaulted: BuiltinSourceSlug[];
} {
  const now = Date.now();
  const created: BuiltinSourceSlug[] = [];
  const defaulted: BuiltinSourceSlug[] = [];
  const rootSources = sourcesDir(workspaceRootPath);
  if (!existsSync(rootSources)) {
    mkdirSync(rootSources, { recursive: true });
  }

  for (const slug of BUILTIN_SOURCE_SLUGS) {
    const dir = join(rootSources, slug);
    const configPath = join(dir, 'config.json');
    if (existsSync(configPath)) {
      const marker = join(rootSources, `.default-services-v1-${slug}`);
      if (!existsSync(marker)) {
        try {
          const previous = JSON.parse(readFileSync(configPath, 'utf8')) as FolderSourceConfig;
          if (isManagedBuiltinSource(previous)) {
            const edited = previous.createdAt === undefined || previous.updatedAt === undefined
              || previous.createdAt !== previous.updatedAt;
            if (previous.enabled || !edited) {
              writeFileSync(configPath, `${JSON.stringify({ ...previous, enabled: true }, null, 2)}\n`);
              defaulted.push(slug);
            }
            writeFileSync(marker, '1\n');
          }
        } catch { /* malformed user configuration remains untouched */ }
      }
      continue;
    }
    const config = buildBuiltinConfig(slug, now);
    writeSourceFolder(workspaceRootPath, config, GUIDES[slug]);
    writeFileSync(join(rootSources, `.default-services-v1-${slug}`), '1\n');
    created.push(slug);
    defaulted.push(slug);
  }
  return { created, defaulted };
}

/**
 * In-memory builtin sources (also mirrored on disk by ensureBuiltinSources).
 * Kept for loadAllSources / getSourcesBySlugs compatibility.
 */
export function getBuiltinSources(workspaceId: string, workspaceRootPath: string): LoadedSource[] {
  const now = Date.now();
  return BUILTIN_SOURCE_SLUGS.map((slug) => ({
    workspaceId, workspaceRootPath,
    folderPath: join(sourcesDir(workspaceRootPath), slug),
    config: buildBuiltinConfig(slug, now), guide: { raw: GUIDES[slug] }, isBuiltin: true,
  }));
}

/**
 * Placeholder for the always-available craft-agents-docs MCP server
 * (configured in craft-agent.ts, not a folder source). Kept for
 * getSourcesBySlugs('craft-agents-docs') callers.
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-craft-agents-docs',
    name: 'Craft Agents Docs',
    slug: 'craft-agents-docs',
    enabled: true,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'https://agents.craft.do/docs/mcp',
      authType: 'none',
    },
    tagline: 'Search Craft Agents documentation and source setup guides',
    icon: '📚',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config: placeholderConfig,
    guide: { raw: '' },
    isBuiltin: true,
  };
}

export function isBuiltinSource(slug: string): boolean {
  return (BUILTIN_SOURCE_SLUGS as readonly string[]).includes(slug) || slug === 'craft-agents-docs';
}

/** Rough token estimate for a source guide / attached text (chars/4). */
export function estimateSourceGuideTokens(source: LoadedSource): number {
  const raw = source.guide?.raw ?? '';
  return estimateTokens(raw);
}

/** Format ≈N ток. label (locale-agnostic number, caller i18n wraps). */
export function formatTokenEstimate(tokens: number): string {
  if (tokens >= 1_000_000) return `≈${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `≈${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return `≈${tokens}`;
}
