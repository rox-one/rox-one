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
 *      source files from the sibling `.js.map`,
 *   3. identify the boot entry (`src/renderer/bootstrap.ts`), the modules the
 *      boot always loads dynamically (`src/renderer/main.tsx`), and each boot
 *      route's chunk from `ROUTE_PAGE_LOADERS`,
 *   4. walk STATIC edges only — a dynamic edge is a lazy boundary, so it is
 *      never crossed,
 *   5. write `apps/electron/src/renderer/boot-manifest.json`.
 *
 * The route ids are the ones `perf/surface-sim.ts` models (`KEEPALIVE_WARM_SURFACES`),
 * read from source so a rename fails loudly instead of silently drifting.
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
 *   bun run scripts/boot-manifest.ts --no-build # never build; fail if dist is missing
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const ELECTRON_DIR = join(ROOT, 'apps/electron')
const RENDERER_SRC = join(ELECTRON_DIR, 'src/renderer')
const DIST_DIR = join(ELECTRON_DIR, 'dist/renderer')
const MANIFEST_PATH = join(RENDERER_SRC, 'boot-manifest.json')
const SURFACE_SIM = join(RENDERER_SRC, 'perf/surface-sim.ts')
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
  /** The route's own (lazily loaded) chunk. */
  chunk: string
  /** Every chunk reachable at boot for this route (entry + main + route closure). */
  chunks: string[]
}

export interface BootManifest {
  version: 1
  generator: 'scripts/boot-manifest.ts'
  entry: string
  /** Chunks loaded by every boot, before any route is reached (sorted). */
  bootChunks: string[]
  routes: Record<string, BootRouteEntry>
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
}

/** Derive the manifest from a chunk graph. Pure and deterministic. */
export function deriveBootManifest(input: DeriveInput): BootManifest {
  const { graph, routeModules } = input
  const staticEntry = input.bootStaticEntry ?? BOOT_STATIC_ENTRY
  const dynamicEntries = input.bootDynamicEntries ?? BOOT_DYNAMIC_ENTRIES

  const entry = chunkForModule(graph, staticEntry)
  if (!entry) throw new Error(`boot-manifest: no chunk built from ${staticEntry}`)

  const boot = new Set<string>(staticClosure(entry, graph))
  for (const module of dynamicEntries) {
    const chunk = chunkForModule(graph, module)
    if (!chunk) throw new Error(`boot-manifest: no chunk built from boot module ${module}`)
    for (const file of staticClosure(chunk, graph)) boot.add(file)
  }
  const bootChunks = [...boot].sort()

  const routes: Record<string, BootRouteEntry> = {}
  for (const [id, suffix] of Object.entries(routeModules).sort(([a], [b]) => a.localeCompare(b))) {
    const chunk = chunkForModule(graph, suffix)
    if (!chunk) throw new Error(`boot-manifest: no chunk for route "${id}" (${suffix})`)
    const chunks = new Set(bootChunks)
    for (const file of staticClosure(chunk, graph)) chunks.add(file)
    routes[id] = { chunk, chunks: [...chunks].sort() }
  }

  return { version: 1, generator: 'scripts/boot-manifest.ts', entry, bootChunks, routes }
}

export interface ManifestDiff {
  ok: boolean
  entry?: { expected: string; actual: string }
  bootChunks: { missing: string[]; extra: string[] }
  routes: Record<string, { missing: string[]; extra: string[]; chunk?: { expected: string; actual: string } }>
}

/** Structural diff of a derived manifest against the committed one. */
export function diffBootManifest(expected: BootManifest, actual: BootManifest): ManifestDiff {
  const setDiff = (want: string[], have: string[]) => ({
    missing: want.filter(x => !have.includes(x)),
    extra: have.filter(x => !want.includes(x)),
  })
  const diff: ManifestDiff = {
    ok: true,
    bootChunks: setDiff(expected.bootChunks, actual.bootChunks),
    routes: {},
  }
  if (expected.entry !== actual.entry) {
    diff.entry = { expected: expected.entry, actual: actual.entry }
  }
  for (const id of [...new Set([...Object.keys(expected.routes), ...Object.keys(actual.routes)])].sort()) {
    const want = expected.routes[id]
    const have = actual.routes[id]
    if (!want || !have) {
      diff.routes[id] = { missing: want ? want.chunks : [], extra: have ? have.chunks : [] }
      continue
    }
    const entryDiff = setDiff(want.chunks, have.chunks)
    const violation: { missing: string[]; extra: string[]; chunk?: { expected: string; actual: string } } = {
      ...entryDiff,
    }
    if (want.chunk !== have.chunk) violation.chunk = { expected: want.chunk, actual: have.chunk }
    if (entryDiff.missing.length || entryDiff.extra.length || violation.chunk) diff.routes[id] = violation
  }
  diff.ok =
    !diff.entry &&
    diff.bootChunks.missing.length === 0 &&
    diff.bootChunks.extra.length === 0 &&
    Object.keys(diff.routes).length === 0
  return diff
}

/** Serialize a manifest exactly as it is committed (stable bytes). */
export function serializeBootManifest(manifest: BootManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
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
  const bootIds = parseStringArray(readFileSync(SURFACE_SIM, 'utf8'), 'KEEPALIVE_WARM_SURFACES')
  const modules: Record<string, string> = {}
  for (const id of bootIds) {
    const specifier = loaders[id]
    if (!specifier) throw new Error(`boot-manifest: boot route "${id}" has no ROUTE_PAGE_LOADERS entry`)
    modules[id] = loaderSourceSuffix(specifier)
  }
  return modules
}

export function deriveFromDist(distDir: string): BootManifest {
  const graph = buildChunkGraph(readRawChunks(distDir))
  return deriveBootManifest({ graph, routeModules: readRouteModules() })
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

function formatDiff(diff: ManifestDiff): string {
  const lines: string[] = []
  if (diff.entry) lines.push(`  entry: ${diff.entry.expected} → ${diff.entry.actual}`)
  if (diff.bootChunks.missing.length || diff.bootChunks.extra.length) {
    lines.push(`  bootChunks -${diff.bootChunks.missing.join(',') || '∅'} +${diff.bootChunks.extra.join(',') || '∅'}`)
  }
  for (const [id, entry] of Object.entries(diff.routes)) {
    if (entry.chunk) lines.push(`  ${id}: chunk ${entry.chunk.expected} → ${entry.chunk.actual}`)
    if (entry.missing.length || entry.extra.length) {
      lines.push(`  ${id}: -${entry.missing.join(',') || '∅'} +${entry.extra.join(',') || '∅'}`)
    }
  }
  return lines.join('\n')
}

async function ensureDist(allowBuild: boolean): Promise<void> {
  if (existsSync(DIST_DIR)) return
  if (!allowBuild) throw new Error(`boot-manifest: ${DIST_DIR} is missing and --no-build was given`)
  console.log('[boot-manifest] dist missing — building the renderer (vite build)…')
  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'vite', 'build', '--config', 'apps/electron/vite.config.ts'],
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`boot-manifest: renderer build failed (exit ${code})`)
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const allowBuild = !args.includes('--no-build')

  await ensureDist(allowBuild)

  const derived = deriveFromDist(DIST_DIR)
  const serialized = serializeBootManifest(derived)

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
  if (before === serialized) {
    console.log(`[boot-manifest] no-op: ${relative(ROOT, MANIFEST_PATH)} already current`)
    return 0
  }
  writeFileSync(MANIFEST_PATH, serialized)
  console.log(`[boot-manifest] wrote ${relative(ROOT, MANIFEST_PATH)} (${derived.bootChunks.length} boot chunks, ${Object.keys(derived.routes).length} routes)`)
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