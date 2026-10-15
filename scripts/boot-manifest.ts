#!/usr/bin/env bun
/**
 * Boot manifest (openclaw-port row b1.2).
 *
 * The renderer boots once and then lazily reaches one rail surface at a time.
 * A surface that is statically imported by a boot module stops being lazy: its
 * chunk lands in the boot graph, the first paint pays for it, and the idle
 * warm-up (`lib/shell-warmup.ts`) is wasted. This script derives, statically,
 * the module graph every boot route reaches, so the boundary is a checked file
 * instead of a convention.
 *
 * Approach — a STATIC closure over the built chunks plus the existing
 * route→chunk mapping:
 *   1. read every JS chunk Vite emitted under apps/electron/dist/renderer,
 *   2. read each chunk's static and dynamic import edges from its code and its
 *      source files from the sibling `.js.map` (so the dist MUST be built with
 *      `ROX_RENDERER_SOURCEMAP=1`; see `rendererBuildEnv` — the script sets it
 *      for the build it spawns, and refuses to read a dist that lacks maps),
 *   3. identify the boot entry (`src/renderer/bootstrap.ts`), the modules the
 *      boot always loads dynamically (`src/renderer/main.tsx`), and each boot
 *      route's chunk from `ROUTE_PAGE_LOADERS`,
 *   4. walk STATIC edges only — a dynamic edge is a lazy boundary, so it is
 *      never crossed,
 *   5. write `apps/electron/src/renderer/boot-manifest.json` — build-INDEPENDENT
 *      identity only (the source sets above). The build-fixed hash names
 *      (`entry`, `bootChunks`, per-route `chunk`/`chunks`) go to the git-ignored
 *      `boot-manifest.local.json` beside it, so an ordinary renderer edit no
 *      longer rewrites a 20k-line committed file.
 *
 * The route ids are the real boot warm-up set: `lib/shell-warmup.ts` preloads
 * every entry of `RAIL_SURFACE_ROUTES`, which aliases `RAIL_SURFACE_ROUTE_IDS`
 * in `shared/rail-surfaces.ts`. We read that import-free list from source so a
 * rename fails loudly instead of silently drifting (the perf-simulation
 * constant `KEEPALIVE_WARM_SURFACES` models a subset and is NOT the source).
 *
 * Real-Chromium alternative (NOT taken): the installed Playwright could load the
 * built index.html and record requests, but the app shell needs `window.electronAPI`
 * and main-process IPC to mount a route, and the perf fixture (`perf-dom.html`)
 * exposes neither `ROUTE_PAGE_LOADERS` nor navigation. Driving seven real boot
 * routes would need a fake preload API plus a route driver — more invented
 * surface than the manifest is worth. The static method cannot see:
 * runtime-conditional `import()` (flag/env-gated), the i18n locale chunks fetched
 * at runtime by `preloadRendererLocales()`, CSS/asset URLs, and Vite's
 * `__vitePreload` dependency list (which mirrors the static edges we already walk).
 *
 * Usage:
 *   bun run scripts/boot-manifest.ts           # build if needed, (re)write the manifest
 *   bun run scripts/boot-manifest.ts --check   # derive and diff; write nothing (idempotent)
 *   bun run scripts/boot-manifest.ts --no-build # never build; fail if dist is missing, stale or map-less
 *
 * "Build if needed" includes a dist that exists but carries no source maps: the
 * spawn below sets `ROX_RENDERER_SOURCEMAP=1` for exactly that reason.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const ELECTRON_DIR = join(ROOT, 'apps/electron')
const RENDERER_SRC = join(ELECTRON_DIR, 'src/renderer')
const DIST_DIR = join(ELECTRON_DIR, 'dist/renderer')
const MANIFEST_PATH = join(RENDERER_SRC, 'boot-manifest.json')
/** Sibling of the manifest: the build-fixed hash names, never committed (see `.gitignore`). */
const LOCAL_MANIFEST_PATH = join(RENDERER_SRC, 'boot-manifest.local.json')
const RAIL_SURFACES = join(ELECTRON_DIR, 'src/shared/rail-surfaces.ts')
const ROUTE_PAGES = join(RENDERER_SRC, 'components/app-shell/route-pages.ts')

/** Rendering-source modules that are always loaded at boot. */
export const BOOT_STATIC_ENTRY = 'src/renderer/bootstrap.ts'
export const BOOT_DYNAMIC_ENTRIES = ['src/renderer/main.tsx'] as const

export interface ChunkGraphEntry {
  /** POSIX path relative to the dist root, e.g. `assets/index-abc.js`. */
  file: string
  /** Static imports/exports, resolved to dist-relative POSIX paths. */
  staticImports: string[]
  /** `import(...)` targets, resolved to dist-relative POSIX paths. */
  dynamicImports: string[]
  /** Source files the chunk was built from (POSIX, repo-relative-ish). */
  sources: string[]
}

export interface BootRouteEntry {
  /** STABLE identity of the closure: the source modules it was built from (sorted). */
  sources: string[]
}

/**
 * The COMMITTED manifest: build-independent identity only. Emitted chunk names
 * are content hashes that move between builds of the same tree, so committing
 * them made every renderer edit rewrite a 20k-line file that no gate compares.
 */
export interface BootManifest {
  version: 1
  generator: 'scripts/boot-manifest.ts'
  /** STABLE identity of the boot closure: its source modules (sorted). */
  bootSources: string[]
  routes: Record<string, BootRouteEntry>
}

/** What the derivation knows: the committed identity plus the build-fixed hash names. */
export interface DerivedBootManifest extends BootManifest {
  entry: string
  /** Chunks loaded by every boot, before any route is reached (sorted). */
  bootChunks: string[]
  routes: Record<
    string,
    BootRouteEntry & {
      /** The route's own (lazily loaded) chunk (informational: hashes move per build). */
      chunk: string
      /** Every chunk reachable at boot for this route (entry + main + route closure). */
      chunks: string[]
    }
  >
}

/** The git-ignored sibling of the manifest: hash names kept for debugging only. */
export interface DebugBootManifest {
  version: 1
  generator: 'scripts/boot-manifest.ts'
  /** Renderer-inputs digest at derivation time (see `hashRendererInputs`). */
  inputsHash: string
  entry: string
  bootChunks: string[]
  routes: Record<string, { chunk: string; chunks: string[] }>
}

/* -------------------------------------------------------------------------- */
/* import-edge extraction                                                      */
/* -------------------------------------------------------------------------- */

/** `import("./x.js")` / `__vitePreload(()=>import("./x.js"),…)` — lazy edges. */
function parseDynamicImports(code: string): string[] {
  const out = new Set<string>()
  for (const match of code.matchAll(/import\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) out.add(match[2])
  return [...out]
}

/**
 * `import"…"`, `import{a}from"…"`, `export{a}from"…"` — eager edges. Dynamic
 * imports are blanked first so `import(` never leaks into the `from` scan, and
 * the `import.meta` member is never a match because a quote must follow.
 */
function parseStaticImports(code: string): string[] {
  const withoutDynamic = code.replace(/import\s*\(\s*(['"])([^'"]+)\1\s*\)/g, '0')
  const out = new Set<string>()
  for (const match of withoutDynamic.matchAll(/(?:from\s*|import\s*)(['"])([^'"]+)\1/g)) out.add(match[2])
  return [...out]
}

/** Resolve a chunk-relative specifier (`./x.js`, `../assets/y.js`) to a dist path. */
function resolveSpecifier(spec: string, fromFile: string): string {
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromFile), spec))
  return posix.normalize(spec)
}

/* -------------------------------------------------------------------------- */
/* bundle loading                                                              */
/* -------------------------------------------------------------------------- */

export interface RawChunk {
  file: string
  code: string
  sources: string[]
}

/**
 * Turn in-memory chunks into the graph the closure walks. Pure: the same input
 * always yields the same output, which is what makes the manifest byte-stable.
 */
export function buildChunkGraph(raw: readonly RawChunk[]): Map<string, ChunkGraphEntry> {
  const known = new Set(raw.map(chunk => chunk.file))
  const graph = new Map<string, ChunkGraphEntry>()
  const resolveEdges = (specs: string[], file: string): string[] => {
    const out = new Set<string>()
    for (const spec of specs) {
      const target = resolveSpecifier(spec, file)
      if (known.has(target)) out.add(target)
    }
    return [...out].sort()
  }
  for (const chunk of raw) {
    graph.set(chunk.file, {
      file: chunk.file,
      staticImports: resolveEdges(parseStaticImports(chunk.code), chunk.file),
      dynamicImports: resolveEdges(parseDynamicImports(chunk.code), chunk.file),
      sources: [...chunk.sources].sort(),
    })
  }
  return graph
}

/** Static-only closure of `start` (inclusive), sorted; never crosses a dynamic edge. */
export function staticClosure(start: string, graph: ReadonlyMap<string, ChunkGraphEntry>): string[] {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length > 0) {
    const file = stack.pop()!
    if (seen.has(file) || !graph.has(file)) continue
    seen.add(file)
    for (const next of graph.get(file)!.staticImports) if (!seen.has(next)) stack.push(next)
  }
  return [...seen].sort()
}

/** The chunk whose sources contain a module path ending in `suffix`. */
export function chunkForModule(
  graph: ReadonlyMap<string, ChunkGraphEntry>,
  suffix: string,
): string | undefined {
  const needle = suffix.replace(/\\/g, '/').replace(/\.(?:tsx|ts|jsx|js|mjs|mts)$/, '')
  const hits = [...graph.values()]
    .filter(chunk =>
      chunk.sources.some(source => {
        const bare = source.replace(/\.(?:tsx|ts|jsx|js|mjs|mts)$/, '')
        return bare === needle || bare.endsWith(`/${needle}`)
      }),
    )
    .map(chunk => chunk.file)
    .sort()
  return hits[0]
}

/* -------------------------------------------------------------------------- */
/* route → chunk mapping (ROUTE_PAGE_LOADERS, read from source)                */
/* -------------------------------------------------------------------------- */

/** Extract `name: () => import('spec')` entries from `route-pages.ts`. */
export function parseRoutePageLoaders(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of source.matchAll(/(\w+)\s*:\s*\(\s*\)\s*=>\s*import\(\s*(['"])([^'"]+)\2\s*\)/g)) {
    out[match[1]] = match[3]
  }
  return out
}

/** Extract the quoted ids of a `const NAME = [...] as const` array from source. */
export function parseStringArray(source: string, name: string): string[] {
  const start = source.indexOf(`export const ${name}`)
  if (start < 0) throw new Error(`boot-manifest: ${name} not found`)
  const end = source.indexOf(']', start)
  if (end < 0) throw new Error(`boot-manifest: ${name} array is unterminated`)
  const out: string[] = []
  for (const match of source.slice(start, end).matchAll(/'([^']+)'/g)) out.push(match[1])
  return out
}

/** Resolve a loader specifier to the source-file suffix its chunk's map will carry. */
export function loaderSourceSuffix(specifier: string): string {
  if (specifier.startsWith('@/')) return `src/renderer/${specifier.slice(2)}`
  if (specifier.startsWith('.')) {
    return posix.normalize(posix.join('src/renderer/components/app-shell', specifier))
  }
  return specifier
}

/* -------------------------------------------------------------------------- */
/* derivation + diff                                                           */
/* -------------------------------------------------------------------------- */

export interface DeriveInput {
  graph: ReadonlyMap<string, ChunkGraphEntry>
  /** Route id → source suffix (no extension) of its lazily loaded page module. */
  routeModules: Record<string, string>
  bootStaticEntry?: string
  bootDynamicEntries?: readonly string[]
  /**
   * The dist the graph was read from. Source-map `sources` are written relative
   * to the chunk that carries them, so this is what turns them back into
   * repo-relative paths; defaults to this repo's renderer dist.
   */
  distRoot?: string
}

/** Derive the manifest from a chunk graph. Pure and deterministic. */
export function deriveBootManifest(input: DeriveInput): DerivedBootManifest {
  const { graph, routeModules } = input
  const staticEntry = input.bootStaticEntry ?? BOOT_STATIC_ENTRY
  const dynamicEntries = input.bootDynamicEntries ?? BOOT_DYNAMIC_ENTRIES
  const distPrefix = relative(ROOT, input.distRoot ?? DIST_DIR).split(sep).join('/')

  const entry = chunkForModule(graph, staticEntry)
  if (!entry) throw new Error(`boot-manifest: no chunk built from ${staticEntry}`)

  const boot = new Set<string>(staticClosure(entry, graph))
  for (const module of dynamicEntries) {
    const chunk = chunkForModule(graph, module)
    if (!chunk) throw new Error(`boot-manifest: no chunk built from boot module ${module}`)
    for (const file of staticClosure(chunk, graph)) boot.add(file)
  }
  const bootChunks = [...boot].sort()
  const bootSources = closureSources(graph, bootChunks, distPrefix)

  const routes: DerivedBootManifest['routes'] = {}
  for (const [id, suffix] of Object.entries(routeModules).sort(([a], [b]) => a.localeCompare(b))) {
    const chunk = chunkForModule(graph, suffix)
    if (!chunk) throw new Error(`boot-manifest: no chunk for route "${id}" (${suffix})`)
    const chunks = new Set(bootChunks)
    for (const file of staticClosure(chunk, graph)) chunks.add(file)
    const routeChunks = [...chunks].sort()
    routes[id] = { chunk, chunks: routeChunks, sources: closureSources(graph, routeChunks, distPrefix) }
  }

  return { version: 1, generator: 'scripts/boot-manifest.ts', entry, bootChunks, bootSources, routes }
}

export interface ManifestDiff {
  ok: boolean
  bootSources: { missing: string[]; extra: string[] }
  routes: Record<string, { missing: string[]; extra: string[] }>
}

/**
 * Structural diff of a derived manifest against the committed one, over the
 * SOURCE CLOSURE only. That is the identity a gate can compare: chunk names are
 * content hashes that move between builds of the same tree (a laptop build and
 * the ubuntu CI build disagree even on a manifest regenerated the same day), and
 * the committed manifest does not carry them any more.
 */
export function diffBootManifest(expected: BootManifest, actual: BootManifest): ManifestDiff {
  const setDiff = (want: string[], have: string[]) => ({
    missing: want.filter(x => !have.includes(x)),
    extra: have.filter(x => !want.includes(x)),
  })
  const diff: ManifestDiff = {
    ok: true,
    bootSources: setDiff(expected.bootSources ?? [], actual.bootSources ?? []),
    routes: {},
  }
  for (const id of [...new Set([...Object.keys(expected.routes), ...Object.keys(actual.routes)])].sort()) {
    const want = expected.routes[id]
    const have = actual.routes[id]
    if (!want || !have) {
      diff.routes[id] = { missing: want ? want.sources : [], extra: have ? have.sources : [] }
      continue
    }
    const entryDiff = setDiff(want.sources ?? [], have.sources ?? [])
    if (entryDiff.missing.length || entryDiff.extra.length) diff.routes[id] = entryDiff
  }
  diff.ok =
    diff.bootSources.missing.length === 0 &&
    diff.bootSources.extra.length === 0 &&
    Object.keys(diff.routes).length === 0
  return diff
}

/**
 * Serialize the COMMITTED manifest exactly as it is checked in (stable bytes):
 * build-independent identity only. The hash names stay in `serializeDebugManifest`
 * so an ordinary renderer edit — every one of which moves a chunk hash — cannot
 * rewrite this file.
 */
export function serializeBootManifest(manifest: BootManifest): string {
  const committed: BootManifest = {
    version: manifest.version,
    generator: manifest.generator,
    bootSources: manifest.bootSources,
    routes: Object.fromEntries(
      Object.entries(manifest.routes).map(([id, entry]): [string, BootRouteEntry] => [id, { sources: entry.sources }]),
    ),
  }
  return `${JSON.stringify(committed, null, 2)}\n`
}

/** Serialize the git-ignored debug sibling: the build-fixed hash names, for debugging. */
export function serializeDebugManifest(manifest: DerivedBootManifest, inputsHash: string): string {
  const debug: DebugBootManifest = {
    version: manifest.version,
    generator: manifest.generator,
    inputsHash,
    entry: manifest.entry,
    bootChunks: manifest.bootChunks,
    routes: Object.fromEntries(
      Object.entries(manifest.routes).map(
        ([id, entry]): [string, { chunk: string; chunks: string[] }] => [id, { chunk: entry.chunk, chunks: entry.chunks }],
      ),
    ),
  }
  return `${JSON.stringify(debug, null, 2)}\n`
}

/* -------------------------------------------------------------------------- */
/* dist IO                                                                     */
/* -------------------------------------------------------------------------- */

function listJsChunks(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.js')) out.push(full)
    }
  }
  walk(dir)
  return out
}

function readSources(mapPath: string): string[] {
  if (!existsSync(mapPath)) return []
  try {
    const raw = JSON.parse(readFileSync(mapPath, 'utf8')) as { sources?: string[] }
    return (raw.sources ?? []).map(source => source.replace(/\\/g, '/'))
  } catch {
    return []
  }
}

/**
 * Does this dist carry the `*.js.map` files the derivation reads sources from?
 * The shipped renderer build omits them (S9-11), so a dist produced by
 * `bun run electron:build:renderer` alone is unreadable here: every chunk's
 * source set comes out empty and the real failure ("built without source maps")
 * shows up far downstream as "no chunk built from src/renderer/bootstrap.ts".
 */
export function hasSourceMaps(distDir: string): boolean {
  const stack = [distDir]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.endsWith('.js') && existsSync(`${full}.map`)) return true
    }
  }
  return false
}

/** Read the on-disk bundle as raw chunks (deterministic order). */
export function readRawChunks(distDir: string): RawChunk[] {
  return listJsChunks(distDir)
    .map(file => ({
      file: relative(distDir, file).replace(/\\/g, '/'),
      code: readFileSync(file, 'utf8'),
      sources: readSources(`${file}.map`),
    }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

/** Build the route→source-suffix map from the renderer's own registry. */
export function readRouteModules(): Record<string, string> {
  const loaders = parseRoutePageLoaders(readFileSync(ROUTE_PAGES, 'utf8'))
  const bootIds = parseStringArray(readFileSync(RAIL_SURFACES, 'utf8'), 'RAIL_SURFACE_ROUTE_IDS')
  const modules: Record<string, string> = {}
  for (const id of bootIds) {
    const specifier = loaders[id]
    if (!specifier) throw new Error(`boot-manifest: boot route "${id}" has no ROUTE_PAGE_LOADERS entry`)
    modules[id] = loaderSourceSuffix(specifier)
  }
  return modules
}


/** Package roots a normalised name is re-anchored at; the EARLIEST occurrence wins. */
const PACKAGE_ANCHORS = ['apps/', 'packages/', 'node_modules/'] as const

/**
 * Repo-relative POSIX path of one source-map entry. A map writes its `sources`
 * relative to the chunk that carries it (`../../../src/renderer/main.tsx` from
 * `assets/`), so resolving against the chunk — and then against the dist
 * location — is what collapses `../` runs back into a real module path. That
 * resolution is depth-independent: the same module reached from a chunk in
 * `assets/` and one in `assets/nested/` yields the same path and therefore the
 * same manifest name.
 */
function repoRelativeSource(source: string, chunkFile: string, distPrefix: string): string {
  const posixSource = source.replace(/\\/g, '/')
  if (posixSource.startsWith('/')) return posix.normalize(relative(ROOT, posixSource).split(sep).join('/'))
  return posix.normalize(posix.join(distPrefix, posix.dirname(chunkFile), posixSource))
}

/**
 * Stable manifest name of a module: its repo-relative path, re-anchored at the
 * EARLIEST package root, so the name keeps its package prefix
 * (`apps/electron/src/renderer/x.ts`, `packages/foo/src/renderer/x.ts`). The
 * previous version cut at the first *rule* that matched — `/src/` was tested
 * before `/apps/` and `/packages/` — which collapsed those two onto one
 * `src/renderer/x.ts` and silently merged two different modules.
 */
function normaliseSource(repoRelative: string): string {
  let cut = -1
  for (const anchor of PACKAGE_ANCHORS) {
    const at = repoRelative.startsWith(anchor) ? 0 : repoRelative.indexOf(`/${anchor}`)
    if (at === -1) continue
    if (cut === -1 || at < cut) cut = at
  }
  if (cut !== -1) return repoRelative.slice(cut === 0 ? 0 : cut + 1)
  // Outside every package root (a path that escaped the repo, or a build input
  // at the top level): keep the tail rather than inventing a directory.
  return repoRelative.replace(/^\.{1,2}\//, '')
}

/**
 * Every source module a chunk set was built from, normalised to a repo-relative
 * POSIX name. Emitted chunk names (and therefore their hashes) change on almost
 * every renderer edit, so they cannot be the identity a gate compares; the
 * source closure can.
 *
 * Two different modules must never share a name: a collision means the
 * normalisation merged them, and a silent merge would hide a real module
 * (e.g. an eager import of a package that shares a path with the renderer).
 */
function closureSources(
  graph: ReadonlyMap<string, ChunkGraphEntry>,
  files: readonly string[],
  distPrefix: string,
): string[] {
  const named = new Map<string, string>()
  for (const file of files) {
    for (const source of graph.get(file)?.sources ?? []) {
      const module = repoRelativeSource(source, file, distPrefix)
      const name = normaliseSource(module)
      const seen = named.get(name)
      if (seen !== undefined && seen !== module) {
        throw new Error(
          `boot-manifest: two different modules normalise to "${name}" (${seen}, ${module}) — the normalisation is collapsing them`,
        )
      }
      named.set(name, module)
    }
  }
  return [...named.keys()].sort()
}

export function deriveFromDist(distDir: string): DerivedBootManifest {
  const raw = readRawChunks(distDir)
  // A dist built without source maps parses into chunks that carry no sources at
  // all, and `chunkForModule` then matches nothing — which used to be reported
  // as "no chunk built from src/renderer/bootstrap.ts", blaming the module
  // instead of the missing build input.
  if (raw.length > 0 && raw.every(chunk => chunk.sources.length === 0)) {
    throw new Error(
      `boot-manifest: none of the ${raw.length} chunks under ${distDir} carry source-map sources — the renderer was built without ROX_RENDERER_SOURCEMAP=1, and the closure is derived from those sources`,
    )
  }
  const graph = buildChunkGraph(raw)
  return deriveBootManifest({ graph, routeModules: readRouteModules(), distRoot: distDir })
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

function formatDiff(diff: ManifestDiff): string {
  const lines: string[] = []
  if (diff.bootSources.missing.length || diff.bootSources.extra.length) {
    lines.push(`  bootSources -${diff.bootSources.missing.join(',') || '∅'} +${diff.bootSources.extra.join(',') || '∅'}`)
  }
  for (const [id, entry] of Object.entries(diff.routes)) {
    lines.push(`  ${id}: -${entry.missing.join(',') || '∅'} +${entry.extra.join(',') || '∅'}`)
  }
  return lines.join('\n')
}

/** Source roots whose edits invalidate a built renderer. */
const STALENESS_ROOTS = [
  'apps/electron/src',
  'apps/electron/vite.config.ts',
  'apps/electron/index.html',
  'packages/shared/src',
] as const

/** Directories whose contents are build output, never renderer inputs. */
const BUILD_OUTPUT_DIRS = ['node_modules', '.vite', 'dist']
/** Generated files inside the source tree: hashing the manifest must not feed back into its own staleness. */
const GENERATED_INPUTS = ['boot-manifest.json', 'boot-manifest.local.json']

/** Every input file below a staleness root, as a repo-relative POSIX path (sorted). */
function listInputFiles(target: string): string[] {
  const stat = statSync(target, { throwIfNoEntry: false })
  if (!stat) return []
  const file = relative(ROOT, target).split(sep).join('/')
  if (!stat.isDirectory()) return [file]
  const out: string[] = []
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (BUILD_OUTPUT_DIRS.includes(entry.name)) continue
      out.push(...listInputFiles(join(target, entry.name)))
    } else if (!GENERATED_INPUTS.includes(entry.name)) {
      out.push(relative(ROOT, join(target, entry.name)).split(sep).join('/'))
    }
  }
  return out
}

/**
 * Content digest of the renderer inputs. The staleness check used to compare
 * mtimes, which measures clocks rather than content: a `cp -r`, an rsync or a
 * restored cache rewrites every mtime without changing a byte, so a stale dist
 * looked fresh (and a fresh one stale). This digest pins the bytes a build
 * consumed — sorted `path\0content` — and is the single digest the tool uses
 * (recorded in the debug sibling, compared on the next run; no second scheme).
 */
export function hashRendererInputs(roots: readonly string[] = STALENESS_ROOTS): string {
  const hash = createHash('sha256')
  const files = roots.flatMap(root => listInputFiles(isAbsolute(root) ? root : join(ROOT, root))).sort()
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(join(ROOT, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** The debug sibling as parsed JSON, or `{}` — it is a local artefact and may be absent or partial. */
function readDebugManifest(path: string = LOCAL_MANIFEST_PATH): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** The inputs digest recorded next to the manifest, if a previous run recorded one. */
export function recordedInputsHash(path: string = LOCAL_MANIFEST_PATH): string | undefined {
  const raw = readDebugManifest(path)
  return typeof raw.inputsHash === 'string' ? raw.inputsHash : undefined
}

/**
 * A built renderer is reusable only when the renderer inputs still hash to what
 * they hashed to when it was built. A dist with no recorded digest — a fresh CI
 * checkout that built the renderer with `electron:build:renderer`, or a cached
 * dist — cannot be *proven* stale, so it is reused; an unreadable one is still
 * rejected by the source-map guard below.
 *
 * The CALLER decides the recording: both `roots` and `recorded` are required
 * arguments, because a defaulted `recorded` would turn a caller's explicit
 * `undefined` ("nothing has been recorded") back into `recordedInputsHash()` and
 * silently answer "rebuild" — exactly the case CI runs through.
 */
export function distNeedsBuild(distEntry: string, roots: readonly string[], recorded: string | undefined): boolean {
  if (!existsSync(distEntry)) return true
  if (!recorded) return false
  return hashRendererInputs(roots) !== recorded
}

/**
 * Env for the renderer build this script spawns. The derivation reads every
 * chunk's source list from its sibling `.js.map`, and `apps/electron/vite.config.ts`
 * only emits those under `ROX_RENDERER_SOURCEMAP=1` (the shipped dist stays
 * map-free, S9-11). Building without the flag produced a dist this script cannot
 * read at all, so it always opts in — the flag affects only the build's output,
 * never the product.
 */
export function rendererBuildEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  return { ...env, NODE_OPTIONS: '--max-old-space-size=4096', ROX_RENDERER_SOURCEMAP: '1' }
}

async function ensureDist(allowBuild: boolean): Promise<void> {
  const distEntry = join(DIST_DIR, 'index.html')
  const present = existsSync(DIST_DIR)
  const missing = !present
  const stale = !missing && distNeedsBuild(distEntry, STALENESS_ROOTS, recordedInputsHash())
  // A fresh-but-mapless dist (e.g. `bun run electron:build:renderer`) is just as
  // unusable as a missing one: same rebuild, same fix.
  const unmapped = !missing && !stale && !hasSourceMaps(DIST_DIR)
  if (!missing && !stale && !unmapped) return
  if (!allowBuild) {
    throw new Error(
      missing
        ? `boot-manifest: ${DIST_DIR} is missing and --no-build was given`
        : stale
          ? `boot-manifest: ${DIST_DIR} was built from different renderer inputs and --no-build was given (rebuild with \`bun run vite build\`, or drop --no-build)`
          : `boot-manifest: ${DIST_DIR} has no *.js.map files and the closure is derived from them — rebuild with ROX_RENDERER_SOURCEMAP=1, or drop --no-build`,
    )
  }
  console.log(`[boot-manifest] dist ${missing ? 'missing' : stale ? 'was built from different renderer inputs' : 'has no source maps'} — building the renderer (vite build)…`)
  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'vite', 'build', '--config', 'apps/electron/vite.config.ts'],
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    env: rendererBuildEnv(),
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`boot-manifest: renderer build failed (exit ${code})`)
  // Stamp the dist with the inputs it was built from, so the next run compares
  // content instead of mtimes. Written here (not only in `main`) because a
  // `--check` run rebuilds too and must not rebuild again on the next run.
  writeFileSync(
    LOCAL_MANIFEST_PATH,
    `${JSON.stringify({ ...readDebugManifest(), inputsHash: hashRendererInputs() }, null, 2)}\n`,
  )
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const allowBuild = !args.includes('--no-build')

  await ensureDist(allowBuild)

  const derived = deriveFromDist(DIST_DIR)
  const serialized = serializeBootManifest(derived)
  const debugSerialized = serializeDebugManifest(derived, hashRendererInputs())

  if (check) {
    if (!existsSync(MANIFEST_PATH)) {
      console.error('[boot-manifest] --check: manifest missing; run without --check to write it')
      return 1
    }
    const committed = readFileSync(MANIFEST_PATH, 'utf8')
    const diff = diffBootManifest(JSON.parse(committed) as BootManifest, derived)
    if (!diff.ok) {
      console.error('[boot-manifest] --check: manifest is STALE')
      console.error(formatDiff(diff))
      return 1
    }
    console.log('[boot-manifest] --check: up to date (no changes)')
    return 0
  }

  const before = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, 'utf8') : null
  const debugBefore = existsSync(LOCAL_MANIFEST_PATH) ? readFileSync(LOCAL_MANIFEST_PATH, 'utf8') : null
  if (before === serialized && debugBefore === debugSerialized) {
    console.log(`[boot-manifest] no-op: ${relative(ROOT, MANIFEST_PATH)} already current`)
    return 0
  }
  writeFileSync(MANIFEST_PATH, serialized)
  writeFileSync(LOCAL_MANIFEST_PATH, debugSerialized)
  console.log(
    `[boot-manifest] wrote ${relative(ROOT, MANIFEST_PATH)} (${derived.bootSources.length} boot sources, ${Object.keys(derived.routes).length} routes) + ${relative(ROOT, LOCAL_MANIFEST_PATH)} (hash names)`,
  )
  return 0
}

if (import.meta.main) {
  main()
    .then(code => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}