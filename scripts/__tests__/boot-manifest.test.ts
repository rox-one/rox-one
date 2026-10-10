/**
 * Boot-manifest boundary test (openclaw-port row b1.2).
 *
 * The manifest pins, per boot route, the chunk set reachable over STATIC import
 * edges only. This file re-derives that closure and diffs it against the
 * committed manifest:
 *
 *  - the synthetic case proves the derivation is deterministic (two generations
 *    are byte-equal) and that the boundary actually bites — a static `import`
 *    of a lazy route module from a boot module moves that module's chunk into
 *    the boot closure and the diff stops matching, which is the failure the
 *    gate exists for;
 *  - the live case (skipped when the renderer has not been built) re-derives
 *    from the real `apps/electron/dist/renderer` and diffs against
 *    `boot-manifest.json`, so the checked-in file cannot silently drift.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildChunkGraph,
  deriveBootManifest,
  deriveFromDist,
  diffBootManifest,
  parseRoutePageLoaders,
  parseStringArray,
  readRouteModules,
  serializeBootManifest,
  staticClosure,
  type BootManifest,
  type RawChunk,
} from '../boot-manifest'

const ROOT = resolve(import.meta.dir, '..', '..')
const RENDERER_SRC = join(ROOT, 'apps/electron/src/renderer')
const DIST = join(ROOT, 'apps/electron/dist/renderer')
const MANIFEST_PATH = join(RENDERER_SRC, 'boot-manifest.json')

/** A miniature bundle: entry → main → (lazy) NotesPage / TasksPage. */
const FIXTURE_CHUNKS: RawChunk[] = [
  {
    file: 'assets/entry.js',
    code: 'import{a}from"./shared.js";import("./main.js");',
    sources: ['../../../src/renderer/bootstrap.ts'],
  },
  {
    file: 'assets/main.js',
    code: 'import{b}from"./shared.js";import{d}from"./vendor.js";import("./NotesPage.js");',
    sources: ['../../src/renderer/main.tsx'],
  },
  { file: 'assets/shared.js', code: 'import"./vendor.js";', sources: [] },
  { file: 'assets/vendor.js', code: 'export const v=1;', sources: [] },
  {
    file: 'assets/NotesPage.js',
    code: 'import{e}from"./editor.js";',
    sources: ['../../src/renderer/pages/NotesPage.tsx'],
  },
  { file: 'assets/editor.js', code: 'export const e=1;', sources: [] },
  {
    file: 'assets/TasksPage.js',
    code: 'export const t=1;',
    sources: ['../../src/renderer/pages/workspace-work/WorkspaceTasksPage.tsx'],
  },
]

const FIXTURE_ROUTES = {
  notes: 'src/renderer/pages/NotesPage',
  tasks: 'src/renderer/pages/workspace-work/WorkspaceTasksPage',
}

const deriveFixture = (chunks: RawChunk[] = FIXTURE_CHUNKS) =>
  deriveBootManifest({ graph: buildChunkGraph(chunks), routeModules: FIXTURE_ROUTES })

describe('boot manifest derivation', () => {
  it('walks static edges only, so a dynamic route import stays lazy', () => {
    const manifest = deriveFixture()
    expect(manifest.entry).toBe('assets/entry.js')
    // entry + main + shared + vendor; NotesPage/editor stay out of boot.
    expect(manifest.bootChunks).toEqual([
      'assets/entry.js',
      'assets/main.js',
      'assets/shared.js',
      'assets/vendor.js',
    ])
    expect(manifest.routes.notes).toEqual({
      chunk: 'assets/NotesPage.js',
      chunks: ['assets/NotesPage.js', 'assets/editor.js', 'assets/entry.js', 'assets/main.js', 'assets/shared.js', 'assets/vendor.js'],
    })
    expect(manifest.routes.tasks.chunks).toEqual([
      'assets/TasksPage.js',
      'assets/entry.js',
      'assets/main.js',
      'assets/shared.js',
      'assets/vendor.js',
    ])
  })

  it('is deterministic — two generations are byte-equal', () => {
    const first = serializeBootManifest(deriveFixture())
    const second = serializeBootManifest(deriveFixture())
    expect(second).toBe(first)
    // Re-deriving from already-parsed chunks (a second generation of the graph)
    // must not reorder anything either.
    const firstGraph = buildChunkGraph(FIXTURE_CHUNKS)
    const secondGraph = buildChunkGraph([...FIXTURE_CHUNKS].reverse())
    expect(staticClosure('assets/entry.js', secondGraph)).toEqual(staticClosure('assets/entry.js', firstGraph))
  })

  it('FAILS the boundary when a boot module statically imports a lazy route', () => {
    const expected = deriveFixture()
    // The regression this gate exists for: `main` pulls the Notes page in eagerly.
    const leaked = FIXTURE_CHUNKS.map(chunk =>
      chunk.file === 'assets/main.js'
        ? { ...chunk, code: 'import"./NotesPage.js";import{b}from"./shared.js";' }
        : chunk,
    )
    const derived = deriveFixture(leaked)

    const diff = diffBootManifest(expected, derived)
    expect(diff.ok).toBe(false)
    expect(diff.bootChunks.extra).toContain('assets/NotesPage.js')
    expect(diff.bootChunks.extra).toContain('assets/editor.js')
    // ...and every route that did not already reach the leaked modules grew.
    expect(diff.routes.tasks.extra).toEqual(['assets/NotesPage.js', 'assets/editor.js'])
  })

  it('accepts an unchanged bundle and every route id the boot warm-up preloads', () => {
    const expected = deriveFixture()
    expect(diffBootManifest(expected, deriveFixture()).ok).toBe(true)
    const bootIds = readRouteModules()
    expect(Object.keys(bootIds).sort()).toEqual([
      'agentsWorkspace',
      'automationEditor',
      'browser',
      'cloudRun',
      'connections',
      'feed',
      'inbox',
      'integrationsCatalog',
      'knowledgeHome',
      'notes',
      'pagesHome',
      'planWorkspace',
      'skillsCatalog',
      'tasks',
      'terminal',
    ])
  })

  it('reads the route→chunk mapping and boot route ids from the renderer source', () => {
    const loaders = parseRoutePageLoaders(readFileSync(join(RENDERER_SRC, 'components/app-shell/route-pages.ts'), 'utf8'))
    expect(loaders.notes).toBe('@/pages/NotesPage')
    expect(loaders.inbox).toBe('@/pages/InboxPage')
    const rail = parseStringArray(readFileSync(join(ROOT, 'apps/electron/src/shared/rail-surfaces.ts'), 'utf8'), 'RAIL_SURFACE_ROUTE_IDS')
    expect(rail).toHaveLength(15)
    expect(rail).toEqual([
      'notes',
      'tasks',
      'planWorkspace',
      'agentsWorkspace',
      'inbox',
      'feed',
      'skillsCatalog',
      'integrationsCatalog',
      'knowledgeHome',
      'pagesHome',
      'connections',
      'browser',
      'terminal',
      'cloudRun',
      'automationEditor',
    ])
  })
})

describe.skipIf(!existsSync(DIST) || !existsSync(MANIFEST_PATH))('boot manifest against the built renderer', () => {
  it('re-derives the committed manifest exactly', () => {
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as BootManifest
    const derived = deriveFromDist(DIST)
    const diff = diffBootManifest(committed, derived)
    expect(diff).toEqual({
      ok: true,
      bootChunks: { missing: [], extra: [] },
      routes: {},
    })
    expect(serializeBootManifest(derived)).toBe(serializeBootManifest(committed))
  })
})