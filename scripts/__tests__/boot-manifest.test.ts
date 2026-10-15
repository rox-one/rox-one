/**
 * Boot-manifest boundary test (openclaw-port row b1.2).
 *
 * The manifest pins, per boot route, the module set reachable over STATIC import
 * edges only. This file re-derives that closure and diffs it against the
 * committed manifest:
 *
 *  - the synthetic case proves the derivation is deterministic (two generations
 *    are byte-equal), that normalised names keep their package prefix, and that
 *    the boundary actually bites — a static `import` of a lazy route module from
 *    a boot module moves that module's source into the boot closure and the diff
 *    stops matching, which is the failure the gate exists for;
 *  - the committed file is build-INDEPENDENT (no emitted chunk names), so the
 *    case that runs against the real dist diffs the source closure — never hash
 *    names, which move between builds of the same tree;
 *  - the live case FAILS (rather than skips) when CI has no built renderer: a
 *    green skip on the one machine that must build would disable the gate.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import type { BootManifest, DebugBootManifest, RawChunk } from '../boot-manifest'
import {
  buildChunkGraph,
  deriveBootManifest,
  deriveFromDist,
  diffBootManifest,
  distNeedsBuild,
  hashRendererInputs,
  hasSourceMaps,
  parseRoutePageLoaders,
  parseStringArray,
  readRouteModules,
  recordedInputsHash,
  rendererBuildEnv,
  serializeBootManifest,
  serializeDebugManifest,
  staticClosure,
} from '../boot-manifest'

const ROOT = resolve(import.meta.dir, '..', '..')
const RENDERER_SRC = join(ROOT, 'apps/electron/src/renderer')
const DIST = join(ROOT, 'apps/electron/dist/renderer')
const MANIFEST_PATH = join(RENDERER_SRC, 'boot-manifest.json')
const ROUTE_PAGES = join(RENDERER_SRC, 'components/app-shell/route-pages.ts')
const RAIL_SURFACES = join(ROOT, 'apps/electron/src/shared/rail-surfaces.ts')

/**
 * A miniature bundle: entry → main → (lazy) NotesPage / TasksPage. The map
 * `sources` are chunk-relative exactly as Vite writes them — `assets/` sits
 * three levels under `apps/electron` — so the fixture exercises the real
 * resolution instead of a path shape that only the old truncation accepted.
 */
const FIXTURE_CHUNKS: RawChunk[] = [
  {
    file: 'assets/entry.js',
    code: 'import{a}from"./shared.js";import("./main.js");',
    sources: ['../../../src/renderer/bootstrap.ts'],
  },
  {
    file: 'assets/main.js',
    code: 'import{b}from"./shared.js";import{d}from"./vendor.js";import("./NotesPage.js");',
    sources: ['../../../src/renderer/main.tsx'],
  },
  { file: 'assets/shared.js', code: 'import"./vendor.js";', sources: [] },
  { file: 'assets/vendor.js', code: 'export const v=1;', sources: [] },
  {
    file: 'assets/NotesPage.js',
    code: 'import{e}from"./editor.js";',
    sources: ['../../../src/renderer/pages/NotesPage.tsx'],
  },
  { file: 'assets/editor.js', code: 'export const e=1;', sources: [] },
  {
    file: 'assets/TasksPage.js',
    code: 'export const t=1;',
    sources: ['../../../src/renderer/pages/workspace-work/WorkspaceTasksPage.tsx'],
  },
]

const FIXTURE_ROUTES = {
  notes: 'src/renderer/pages/NotesPage',
  tasks: 'src/renderer/pages/workspace-work/WorkspaceTasksPage',
}

const deriveFixture = (chunks: RawChunk[] = FIXTURE_CHUNKS) =>
  deriveBootManifest({ graph: buildChunkGraph(chunks), routeModules: FIXTURE_ROUTES })

/** The 15 boot warm-up surfaces. Order is not part of the contract, so it is compared as a set. */
const EXPECTED_BOOT_ROUTE_IDS = [
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
] as const

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
    expect(manifest.routes.notes.chunk).toBe('assets/NotesPage.js')
    expect(manifest.routes.notes.chunks).toEqual([
      'assets/NotesPage.js',
      'assets/editor.js',
      'assets/entry.js',
      'assets/main.js',
      'assets/shared.js',
      'assets/vendor.js',
    ])
    // The closure's STABLE identity: the source modules it was built from, named
    // repo-relative so the name keeps its package prefix.
    expect(manifest.bootSources).toEqual([
      'apps/electron/src/renderer/bootstrap.ts',
      'apps/electron/src/renderer/main.tsx',
    ])
    expect(manifest.routes.notes.sources).toEqual([
      'apps/electron/src/renderer/bootstrap.ts',
      'apps/electron/src/renderer/main.tsx',
      'apps/electron/src/renderer/pages/NotesPage.tsx',
    ])
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

  it('names a package module and a renderer module apart, so neither is silently merged', () => {
    // The exact collapse the old anchor order caused: `/src/` was matched before
    // `/apps/` and `/packages/`, so both of these became `src/renderer/x.ts` and
    // the Set kept only one of them.
    const chunks: RawChunk[] = [
      { file: 'assets/boot.js', code: 'import"./app.js";import"./pkg.js";', sources: ['../../../src/renderer/bootstrap.ts'] },
      { file: 'assets/app.js', code: 'export const a=1;', sources: ['../../../src/renderer/x.ts'] },
      { file: 'assets/pkg.js', code: 'export const p=1;', sources: ['../../../../../packages/foo/src/renderer/x.ts'] },
    ]
    // `bootDynamicEntries: []` — these fixtures exercise the normalisation, not
    // the boot-entry lookup the main fixture already covers.
    const manifest = deriveBootManifest({ graph: buildChunkGraph(chunks), routeModules: {}, bootDynamicEntries: [] })
    expect(manifest.bootSources).toEqual([
      'apps/electron/src/renderer/bootstrap.ts',
      'apps/electron/src/renderer/x.ts',
      'packages/foo/src/renderer/x.ts',
    ])
  })

  it('fails loudly when two different modules normalise to one name', () => {
    // One module escapes the repo root and one sits at it: both would be named
    // `x.ts`, which is a merge the closure must never perform silently.
    const chunks: RawChunk[] = [
      { file: 'assets/boot.js', code: 'import"./root.js";import"./outside.js";', sources: ['../../../src/renderer/bootstrap.ts'] },
      { file: 'assets/root.js', code: 'export const r=1;', sources: ['../../../../../x.ts'] },
      { file: 'assets/outside.js', code: 'export const o=1;', sources: ['../../../../../../x.ts'] },
    ]
    expect(() =>
      deriveBootManifest({ graph: buildChunkGraph(chunks), routeModules: {}, bootDynamicEntries: [] }),
    ).toThrow(/two different modules normalise to "x\.ts"/)
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
    expect(diff.bootSources.extra).toContain('apps/electron/src/renderer/pages/NotesPage.tsx')
    // ...and every route that did not already reach the leaked module grew too.
    expect(diff.routes.tasks.extra).toEqual(['apps/electron/src/renderer/pages/NotesPage.tsx'])
  })

  it('accepts an unchanged bundle', () => {
    const expected = deriveFixture()
    expect(diffBootManifest(expected, deriveFixture()).ok).toBe(true)
  })
})

describe('committed manifest shape', () => {
  it('keeps hash names out of the committed file and in the debug sibling', () => {
    const derived = deriveFixture()
    const committed = JSON.parse(serializeBootManifest(derived)) as BootManifest

    // Build-independent identity only: a rebuild that moves every chunk hash
    // must not touch this file.
    expect(Object.keys(committed)).toEqual(['version', 'generator', 'bootSources', 'routes'])
    for (const entry of Object.values(committed.routes)) expect(Object.keys(entry)).toEqual(['sources'])
    // ...so no emitted chunk name (`assets/<name>-<hash>.js`) may appear in it.
    expect(committed.bootSources.filter(source => source.startsWith('assets/'))).toEqual([])

    const debug = JSON.parse(serializeDebugManifest(derived, 'abc123')) as DebugBootManifest
    expect(debug.inputsHash).toBe('abc123')
    expect(debug.entry).toBe('assets/entry.js')
    expect(debug.bootChunks).toEqual(['assets/entry.js', 'assets/main.js', 'assets/shared.js', 'assets/vendor.js'])
    expect(debug.routes.notes.chunk).toBe('assets/NotesPage.js')
    expect(debug.routes.notes.chunks).toHaveLength(6)
  })
})

describe('route ids read from the renderer source', () => {
  it('pins every route id the boot warm-up preloads, as a set', () => {
    const loaders = parseRoutePageLoaders(readFileSync(ROUTE_PAGES, 'utf8'))
    const railIds = parseStringArray(readFileSync(RAIL_SURFACES, 'utf8'), 'RAIL_SURFACE_ROUTE_IDS')
    const routeModules = readRouteModules()

    // Declaration order is not the contract; membership is.
    expect(new Set(railIds)).toEqual(new Set(EXPECTED_BOOT_ROUTE_IDS))
    expect(railIds).toHaveLength(EXPECTED_BOOT_ROUTE_IDS.length)
    // Every warm-up surface resolves through ROUTE_PAGE_LOADERS — `readRouteModules`
    // throws on a surface the loader map does not know.
    expect(new Set(Object.keys(routeModules))).toEqual(new Set(EXPECTED_BOOT_ROUTE_IDS))
    expect(loaders.notes).toBe('@/pages/NotesPage')
    expect(loaders.inbox).toBe('@/pages/InboxPage')
  })
})

/**
 * The live case needs a built renderer. Locally, skipping is fine; in CI it is
 * not — a skip there reports "green" for the gate that exists to fail, so a
 * missing dist is turned into a failure that names the fix.
 */
const distReady = existsSync(DIST) && existsSync(MANIFEST_PATH)

describe('boot manifest against the built renderer', () => {
  it.skipIf(!distReady && !process.env.CI)('re-derives the committed manifest exactly', () => {
    if (!distReady) {
      throw new Error(
        `boot-manifest: ${relative(ROOT, DIST)} is missing — build the renderer first ` +
          '(ROX_RENDERER_SOURCEMAP=1 bun run electron:build:renderer), then re-run this test',
      )
    }
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as BootManifest
    const derived = deriveFromDist(DIST)
    const diff = diffBootManifest(committed, derived)
    // The gate's contract is the closure's STABLE identity (source sets and
    // route ids), never emitted bytes: chunk names are content hashes that
    // move between builds of the same tree (a laptop build and the ubuntu CI
    // build disagree even on a manifest regenerated the same day), which is why
    // the committed file no longer carries them at all.
    expect(diff.ok).toBe(true)
    expect(diff.bootSources).toEqual({ missing: [], extra: [] })
    expect(diff.routes).toEqual({})
    expect(derived.bootSources).toEqual(committed.bootSources)
    expect(new Set(Object.keys(derived.routes))).toEqual(new Set(Object.keys(committed.routes)))
    for (const id of Object.keys(derived.routes)) {
      expect(derived.routes[id].sources).toEqual(committed.routes[id].sources)
    }
  })
})

/**
 * The derivation reads each chunk's sources from its sibling `.js.map`, and the
 * renderer build only emits those under `ROX_RENDERER_SOURCEMAP=1`. A dist built
 * without the flag is unreadable, and the failure used to surface as the
 * misleading "no chunk built from src/renderer/bootstrap.ts" — which is exactly
 * how the gate was red on main.
 */
describe('source-map build input', () => {
  it('builds the renderer it spawns with source maps, keeping the rest of the caller env', () => {
    const env = rendererBuildEnv({ PATH: '/usr/bin', ROX_RENDERER_SOURCEMAP: '0' })
    expect(env.ROX_RENDERER_SOURCEMAP).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=4096')
  })

  it('sees a map-less dist as unreadable and a mapped one as readable', () => {
    const root = mkdtempSync(join(tmpdir(), 'boot-manifest-maps-'))
    try {
      const assets = join(root, 'assets')
      mkdirSync(assets, { recursive: true })
      writeFileSync(join(assets, 'entry-abc.js'), 'export const a = 1\n')
      expect(hasSourceMaps(root)).toBe(false)
      writeFileSync(join(assets, 'entry-abc.js.map'), '{"sources":["../../src/renderer/bootstrap.ts"]}\n')
      expect(hasSourceMaps(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a chunk graph with no sources as a missing build input, not a missing module', () => {
    const root = mkdtempSync(join(tmpdir(), 'boot-manifest-nomaps-'))
    try {
      const assets = join(root, 'assets')
      mkdirSync(assets, { recursive: true })
      // Real emitted chunks, but built without maps: no sibling .js.map files.
      writeFileSync(join(assets, 'main-abc.js'), 'import "./chunk-xyz.js";export const a = 1\n')
      writeFileSync(join(assets, 'chunk-xyz.js'), 'export const b = 2\n')
      let message = ''
      try {
        deriveFromDist(root)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toContain('built without ROX_RENDERER_SOURCEMAP=1')
      // The misleading diagnosis this guard replaces blamed the module instead.
      expect(message).not.toContain('no chunk built from')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * Staleness is decided by CONTENT, not by mtime: a `cp -r`, an rsync or a
 * restored cache rewrites every mtime without changing a byte, so the old
 * comparison could reuse a dist built from different sources (and rebuild one
 * that matched).
 */
describe('dist staleness guard', () => {
  it('compares a digest of the renderer inputs recorded beside the manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'boot-manifest-stale-'))
    try {
      const distEntry = join(root, 'dist', 'index.html')
      const src = join(root, 'src')
      mkdirSync(src, { recursive: true })
      const sourceFile = join(src, 'page.tsx')
      writeFileSync(sourceFile, 'export const page = 1\n')

      // 1) missing entry -> build
      expect(distNeedsBuild(distEntry, [src], hashRendererInputs([src]))).toBe(true)

      // 2) no recorded digest (a fresh CI checkout that built the renderer in an
      //    earlier step) cannot be proven stale -> reuse
      mkdirSync(join(root, 'dist'), { recursive: true })
      writeFileSync(distEntry, '<html></html>\n')
      expect(distNeedsBuild(distEntry, [src], undefined)).toBe(false)

      // 3) same inputs as the record -> reuse, even when the clock says otherwise
      const recorded = hashRendererInputs([src])
      const epoch = new Date(0)
      utimesSync(distEntry, epoch, epoch)
      expect(distNeedsBuild(distEntry, [src], recorded)).toBe(false)

      // 4) an input edited after the build -> rebuild, even with a future dist mtime
      writeFileSync(sourceFile, 'export const page = 2\n')
      utimesSync(sourceFile, epoch, epoch)
      const future = new Date(Date.now() + 60_000)
      utimesSync(distEntry, future, future)
      expect(distNeedsBuild(distEntry, [src], recorded)).toBe(true)

      // 5) build output and generated artefacts are not inputs
      const inputs = hashRendererInputs([src])
      mkdirSync(join(src, 'dist'), { recursive: true })
      mkdirSync(join(src, 'node_modules'), { recursive: true })
      writeFileSync(join(src, 'dist', 'chunk.js'), 'x\n')
      writeFileSync(join(src, 'node_modules', 'dep.js'), 'x\n')
      writeFileSync(join(src, 'boot-manifest.json'), '{}\n')
      writeFileSync(join(src, 'boot-manifest.local.json'), '{}\n')
      expect(hashRendererInputs([src])).toBe(inputs)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads a recorded digest tolerantly and treats a missing or broken record as unknown', () => {
    const root = mkdtempSync(join(tmpdir(), 'boot-manifest-record-'))
    try {
      const record = join(root, 'boot-manifest.local.json')
      expect(recordedInputsHash(record)).toBeUndefined()
      writeFileSync(record, 'not json\n')
      expect(recordedInputsHash(record)).toBeUndefined()
      writeFileSync(record, JSON.stringify({ version: 1, inputsHash: 'deadbeef' }))
      expect(recordedInputsHash(record)).toBe('deadbeef')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
