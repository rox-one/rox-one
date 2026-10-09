/**
 * Knowledge Map tests (plan §3.2 / slice A1).
 *
 * Pure collector tests build a temp corpus (context + memory + notes) and
 * assert link resolution (wiki alias/heading, relative markdown, basename,
 * NFC/case), self-link drop, member edges, caps → truncated, unreadable /
 * oversized → skipped, empty corpus, and full determinism. A handler test
 * (harness mirrors `handlers/rpc/memory-io.test.ts`) asserts
 * `knowledgeMap:get` returns the DTO from the resolved config dir + notes root.
 */
import { describe, expect, it, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { KnowledgeMapDto } from '@rox/shared/knowledge/knowledge-map-types'
import { buildKnowledgeMap } from '../knowledge-map'

const tmpDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

function write(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

/** Corpus with context/memory/notes sources, wiki + markdown links, excluded dirs. */
function buildFixtureCorpus(): { configDir: string; notesRoot: string } {
  const root = makeTempDir('km-fixture-')
  const configDir = join(root, 'config')
  const notesRoot = join(root, 'workspace', 'notes')

  write(configDir, 'context/soul.md', '---\ntitle: Soul\n---\n\n# Душа\n\nСмотри [[rules]], [[rules|правила]] и [[rules#Заголовок]].\n')
  write(configDir, 'context/rules.md', '# Правила\n\nСсылка на [душу](./soul.md).\n')
  write(configDir, 'memory/context.md', '# Контекст памяти\n\nСм. [[soul]].\n')
  write(configDir, 'memory/preferences.md', '# Предпочтения\n')
  write(configDir, 'memory/history/2026-10-01.md', '# 2026-10-01\n')
  write(configDir, 'memory/history/2026-10-02.md', '# 2026-10-02\n')

  write(notesRoot, 'Note A.md', '# Note A\n\nСм. [[doc-b]].\n')
  write(notesRoot, 'doc-b.md', '# Doc B\n')
  write(notesRoot, 'sub/doc-c.md', '# Заметка Ц\n\n[doc-b](../doc-b.md) и [[Note A#heading]].\n')
  write(notesRoot, 'no-title.md', 'текст без заголовка\n')
  write(notesRoot, 'self.md', '# Self\n\n[[self]]\n')

  // Excluded dirs must never enter the corpus.
  write(notesRoot, 'assets/ignored.md', '# Asset\n')
  write(notesRoot, 'templates/t.md', '# Template\n')
  write(notesRoot, '.git/ignored.md', '# Git\n')
  write(notesRoot, '.craft/ignored.md', '# Craft\n')

  return { configDir, notesRoot }
}

function nodeIds(map: KnowledgeMapDto): string[] {
  return map.nodes.map((node) => node.id)
}

function hasEdge(map: KnowledgeMapDto, source: string, target: string, kind: 'link' | 'member'): boolean {
  return map.edges.some((edge) => edge.source === source && edge.target === target && edge.kind === kind)
}

beforeEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('buildKnowledgeMap — corpus & nodes', () => {
  it('collects context, memory and notes docs with area + root nodes', () => {
    const { configDir, notesRoot } = buildFixtureCorpus()
    const map = buildKnowledgeMap({ configDir, notesRoot, rootLabel: 'Профиль' })

    const ids = nodeIds(map)
    expect(ids).toContain('root')
    expect(ids).toContain('area:context')
    expect(ids).toContain('area:memory')
    expect(ids).toContain('area:notes')
    expect(ids).toContain('context:soul.md')
    expect(ids).toContain('context:rules.md')
    expect(ids).toContain('memory:context.md')
    expect(ids).toContain('memory:preferences.md')
    expect(ids).toContain('memory:history/2026-10-01.md')
    expect(ids).toContain('notes:Note A.md')
    expect(ids).toContain('notes:doc-b.md')
    expect(ids).toContain('notes:sub/doc-c.md')

    // Excluded directories never appear.
    expect(ids).not.toContain('notes:assets/ignored.md')
    expect(ids).not.toContain('notes:templates/t.md')
    expect(ids).not.toContain('notes:.git/ignored.md')
    expect(ids).not.toContain('notes:.craft/ignored.md')

    const root = map.nodes.find((node) => node.id === 'root')!
    expect(root.kind).toBe('root')
    expect(root.label).toBe('Профиль')
    expect(root.area).toBe('root')
    expect(map.stats.files).toBe(11)
    expect(map.stats.total).toBe(11)
    expect(map.stats.areas).toBe(3)
    expect(map.stats.skipped).toBe(0)
    expect(map.stats.truncated).toBe(false)
    expect(map.stats.bytes).toBeGreaterThan(0)
  })

  it('labels docs from the first H1 (frontmatter stripped) else the filename', () => {
    const { configDir, notesRoot } = buildFixtureCorpus()
    const map = buildKnowledgeMap({ configDir, notesRoot, rootLabel: 'Профиль' })
    const byId = new Map(map.nodes.map((node) => [node.id, node]))

    expect(byId.get('context:soul.md')!.label).toBe('Душа')
    expect(byId.get('context:rules.md')!.label).toBe('Правила')
    expect(byId.get('notes:Note A.md')!.label).toBe('Note A')
    expect(byId.get('notes:sub/doc-c.md')!.label).toBe('Заметка Ц')
    expect(byId.get('notes:no-title.md')!.label).toBe('no-title')
    expect(byId.get('notes:no-title.md')!.relPath).toBe('no-title.md')
    expect(byId.get('notes:sub/doc-c.md')!.relPath).toBe('sub/doc-c.md')
  })
})

describe('buildKnowledgeMap — edges', () => {
  it('resolves wiki links (alias/heading), relative markdown links and basenames', () => {
    const { configDir, notesRoot } = buildFixtureCorpus()
    const map = buildKnowledgeMap({ configDir, notesRoot, rootLabel: 'Профиль' })

    expect(hasEdge(map, 'context:soul.md', 'context:rules.md', 'link')).toBe(true)
    expect(hasEdge(map, 'context:rules.md', 'context:soul.md', 'link')).toBe(true)
    expect(hasEdge(map, 'memory:context.md', 'context:soul.md', 'link')).toBe(true)
    expect(hasEdge(map, 'notes:Note A.md', 'notes:doc-b.md', 'link')).toBe(true)
    expect(hasEdge(map, 'notes:sub/doc-c.md', 'notes:doc-b.md', 'link')).toBe(true)
    expect(hasEdge(map, 'notes:sub/doc-c.md', 'notes:Note A.md', 'link')).toBe(true)
  })

  it('drops self-links and duplicate links', () => {
    const { configDir, notesRoot } = buildFixtureCorpus()
    const map = buildKnowledgeMap({ configDir, notesRoot, rootLabel: 'Профиль' })

    expect(map.edges.some((edge) => edge.source === edge.target)).toBe(false)
    const duplicates = map.edges.filter((edge) => edge.source === 'context:soul.md' && edge.target === 'context:rules.md')
    expect(duplicates).toHaveLength(1)
    // self.md links to itself → no outbound link edge, linkCount 0.
    expect(map.edges.some((edge) => edge.source === 'notes:self.md' && edge.kind === 'link')).toBe(false)
    expect(map.nodes.find((node) => node.id === 'notes:self.md')!.linkCount).toBe(0)
  })

  it('adds member edges root → area → docs and counts outbound links', () => {
    const { configDir, notesRoot } = buildFixtureCorpus()
    const map = buildKnowledgeMap({ configDir, notesRoot, rootLabel: 'Профиль' })

    for (const area of ['context', 'memory', 'notes']) {
      expect(hasEdge(map, 'root', `area:${area}`, 'member')).toBe(true)
    }
    expect(hasEdge(map, 'area:notes', 'notes:doc-b.md', 'member')).toBe(true)
    expect(hasEdge(map, 'area:context', 'context:soul.md', 'member')).toBe(true)

    expect(map.nodes.find((node) => node.id === 'notes:sub/doc-c.md')!.linkCount).toBe(2)
    expect(map.nodes.find((node) => node.id === 'context:soul.md')!.linkCount).toBe(1)
    expect(map.stats.links).toBe(map.edges.filter((edge) => edge.kind === 'link').length)
  })
})

describe('buildKnowledgeMap — determinism & fail-soft', () => {
  it('produces an identical DTO on repeated runs (except generatedAt)', () => {
    const { configDir, notesRoot } = buildFixtureCorpus()
    const first = buildKnowledgeMap({ configDir, notesRoot, rootLabel: 'Профиль' })
    const second = buildKnowledgeMap({ configDir, notesRoot, rootLabel: 'Профиль' })

    expect(JSON.stringify({ ...first, generatedAt: null })).toBe(JSON.stringify({ ...second, generatedAt: null }))
    expect(typeof first.generatedAt).toBe('string')
  })

  it('returns a valid empty map when every source is missing', () => {
    const root = makeTempDir('km-empty-')
    const map = buildKnowledgeMap({
      configDir: join(root, 'absent'),
      notesRoot: join(root, 'absent-notes'),
      rootLabel: 'Профиль',
    })

    expect(map.stats.files).toBe(0)
    expect(map.stats.total).toBe(0)
    expect(map.stats.areas).toBe(0)
    expect(map.stats.links).toBe(0)
    expect(map.stats.bytes).toBe(0)
    expect(map.stats.skipped).toBe(0)
    expect(map.nodes).toEqual([
      { id: 'root', label: 'Профиль', area: 'root', kind: 'root', size: 0, linkCount: 0, relPath: null },
    ])
    expect(map.edges).toEqual([])
  })

  it('null notesRoot skips the notes area without throwing', () => {
    const configDir = makeTempDir('km-nonotes-')
    write(configDir, 'context/soul.md', '# Душа\n')
    const map = buildKnowledgeMap({ configDir, notesRoot: null, rootLabel: 'Профиль' })

    expect(nodeIds(map)).toEqual(['root', 'area:context', 'context:soul.md'])
    expect(map.stats.files).toBe(1)
  })
})

describe('buildKnowledgeMap — caps & skipped', () => {
  it('caps the notes area at maxDocs and reports truncated', () => {
    const root = makeTempDir('km-cap-')
    const notesRoot = join(root, 'notes')
    for (let i = 0; i < 5; i += 1) write(notesRoot, `n${i}.md`, `# N${i}\n`)

    const map = buildKnowledgeMap({
      configDir: join(root, 'config'),
      notesRoot,
      rootLabel: 'Профиль',
      limits: { maxDocs: 2 },
    })

    expect(map.stats.files).toBe(2)
    expect(map.stats.total).toBe(5)
    expect(map.stats.truncated).toBe(true)
    expect(map.nodes.filter((node) => node.kind === 'doc')).toHaveLength(2)
  })

  it('keeps total === files when the corpus is uncapped', () => {
    const root = makeTempDir('km-uncapped-')
    const notesRoot = join(root, 'notes')
    for (let i = 0; i < 3; i += 1) write(notesRoot, `n${i}.md`, `# N${i}\n`)

    const map = buildKnowledgeMap({ configDir: join(root, 'config'), notesRoot, rootLabel: 'Профиль' })

    expect(map.stats.files).toBe(3)
    expect(map.stats.total).toBe(3)
    expect(map.stats.truncated).toBe(false)
  })

  it('reports total > files when the memory-history limit drops older files', () => {
    const root = makeTempDir('km-history-')
    const configDir = join(root, 'config')
    for (let i = 0; i < 55; i += 1) write(configDir, `memory/history/2026-01-${String(i).padStart(2, '0')}.md`, `# H${i}\n`)

    const map = buildKnowledgeMap({ configDir, notesRoot: null, rootLabel: 'Профиль' })

    expect(map.stats.files).toBe(50)
    expect(map.stats.total).toBe(55)
    expect(map.stats.truncated).toBe(true)
  })

  it('skips files above maxBytesPerDoc (counted as skipped, not truncated)', () => {
    const root = makeTempDir('km-bytes-')
    const notesRoot = join(root, 'notes')
    write(notesRoot, 'small.md', '# small\n')
    write(notesRoot, 'big.md', `# big\n${'x'.repeat(64)}\n`)

    const map = buildKnowledgeMap({
      configDir: join(root, 'config'),
      notesRoot,
      rootLabel: 'Профиль',
      limits: { maxBytesPerDoc: 32 },
    })

    expect(map.stats.skipped).toBe(1)
    expect(map.stats.files).toBe(1)
    expect(map.stats.total).toBe(1)
    expect(map.stats.truncated).toBe(false)
    expect(nodeIds(map)).toContain('notes:small.md')
    expect(nodeIds(map)).not.toContain('notes:big.md')
  })

  it('counts an unreadable file as skipped without throwing', () => {
    const root = makeTempDir('km-unreadable-')
    const notesRoot = join(root, 'notes')
    write(notesRoot, 'ok.md', '# ok\n')
    const blocked = join(notesRoot, 'blocked.md')
    write(notesRoot, 'blocked.md', '# blocked\n')
    chmodSync(blocked, 0o000)

    const map = buildKnowledgeMap({ configDir: join(root, 'config'), notesRoot, rootLabel: 'Профиль' })

    expect(map.stats.files).toBe(1)
    expect(map.stats.skipped).toBe(1)
    expect(nodeIds(map)).toContain('notes:ok.md')
  })
})

describe('buildKnowledgeMap — Unicode', () => {
  it('keeps Cyrillic ids/labels and resolves case-insensitive NFC targets', () => {
    const root = makeTempDir('km-unicode-')
    const notesRoot = join(root, 'notes')
    write(notesRoot, 'Заметка.md', '# Заголовок Кириллицы\n')
    write(notesRoot, 'index.md', '# Указатель\n\n[[заметка]]\n')

    const map = buildKnowledgeMap({ configDir: join(root, 'config'), notesRoot, rootLabel: 'Профиль' })

    expect(nodeIds(map)).toContain('notes:Заметка.md')
    expect(map.nodes.find((node) => node.id === 'notes:Заметка.md')!.label).toBe('Заголовок Кириллицы')
    expect(hasEdge(map, 'notes:index.md', 'notes:Заметка.md', 'link')).toBe(true)
  })
})

// ------------------------------------------------------------------ handler

const handlerConfigDir = mkdtempSync(join(tmpdir(), 'km-handler-config-'))
const handlerWorkspaceRoot = mkdtempSync(join(tmpdir(), 'km-handler-ws-'))
const handlerNotesPath = join(handlerWorkspaceRoot, 'notes')

process.env.ROX_CONFIG_DIR = handlerConfigDir
process.env.CRAFT_CONFIG_DIR = handlerConfigDir
mkdirSync(handlerNotesPath, { recursive: true })
write(handlerConfigDir, 'context/soul.md', '# Душа\n')
write(handlerNotesPath, 'Заметка.md', '# Заметка\n\n[[soul]]\n')

// The handler binds `@rox/shared/config` / `@rox/shared/workspaces` at import
// time, so the mocks must be installed BEFORE the module is imported —
// a runtime-selected import is the only way to control that order in a test.
mock.module('@rox/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) =>
    id === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: handlerWorkspaceRoot } : null,
}))
mock.module('@rox/shared/workspaces', () => ({
  loadWorkspaceConfig: () => ({ notesPath: handlerNotesPath }),
  getDefaultWorkspacesDir: () => join(handlerConfigDir, 'workspaces'),
}))

const { registerKnowledgeMapHandlers } = await import('../../handlers/rpc/knowledge-map')

function createHarness(): Map<string, HandlerFn> {
  const handlers = new Map<string, HandlerFn>()
  const fakeServer = {
    handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler),
  } as unknown as RpcServer
  registerKnowledgeMapHandlers(fakeServer)
  return handlers
}

afterAll(() => {
  mock.restore()
  rmSync(handlerConfigDir, { recursive: true, force: true })
  rmSync(handlerWorkspaceRoot, { recursive: true, force: true })
})

describe('registerKnowledgeMapHandlers', () => {
  it('serves knowledgeMap:get with the DTO built from config dir + notes root', async () => {
    const handlers = createHarness()
    const channel = 'knowledgeMap:get'
    expect(handlers.has(channel)).toBe(true)

    const ctx: RequestContext = { clientId: 'c1', workspaceId: 'ws1', webContentsId: null }
    const result = (await handlers.get(channel)!(ctx)) as KnowledgeMapDto

    expect(result.rootLabel).toBe('Профиль')
    expect(result.nodes.map((node) => node.id)).toContain('context:soul.md')
    expect(result.nodes.map((node) => node.id)).toContain('notes:Заметка.md')
    expect(result.stats.files).toBe(2)
  })

  it('returns a context-only map when no workspace is resolved', async () => {
    const handlers = createHarness()
    const ctx: RequestContext = { clientId: 'c1', workspaceId: null, webContentsId: null }
    const result = (await handlers.get('knowledgeMap:get')!(ctx)) as KnowledgeMapDto

    expect(result.stats.files).toBe(1)
    expect(result.nodes.some((node) => node.area === 'notes')).toBe(false)
  })
})