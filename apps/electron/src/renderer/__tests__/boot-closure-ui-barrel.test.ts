/**
 * Boot-closure guard: no first-party module in `index.html`'s preloaded graph may
 * pull a re-export INDEX out of `@rox/ui` — neither the root barrel (`@rox/ui`)
 * nor a subpath (`@rox/ui/primitives`, `@rox/ui/fx`, `@rox/ui/glass`, …) whose
 * resolved module is itself a re-export index.
 *
 * Evaluating the root barrel pulls every primitive it re-exports — `Island` →
 * `motion`/`framer-motion`, `BrowserControls`, `StyledDropdown`, `Spinner` — into
 * the shared chunk the entry page preloads. Leaf paths (`@rox/ui/tooltip`,
 * `@rox/ui/spinner`, `@rox/ui/markdown`, …) skip it. See
 * `docs/perf/boot-closure-wave-2026-10-15.md`.
 *
 * A subpath is not automatically a leaf. `@rox/ui/primitives`, `@rox/ui/fx` and
 * `@rox/ui/glass` are themselves re-export indices, so a file that moved from
 * `@rox/ui` to `@rox/ui/primitives` would reproduce exactly the class of bug this
 * guard exists for, under a different specifier (issue #2158). So "leaf" is
 * DERIVED from the module the specifier resolves to, not from a list of names:
 *
 *   leaf := a module with no runtime `export * from` and no runtime
 *           `export { … } from` — only its own implementations.
 *
 * Type-only re-exports (`export type { … } from`) and `import type` are erased
 * at build time and pull nothing into the graph, so they are not violations.
 *
 * The file set is DERIVED, not hand-written. This test used to carry
 * `BOOT_BARREL_FILES`, a hand-maintained list of boot-reachable files, and it
 * drifted: `components/shell/NotificationCenter.tsx` is eager (reached through
 * `TopBar`) and imported the barrel, but was never on the list, so the guard
 * stayed green on a tree that violated its own contract. The set now comes from
 * `boot-manifest.json` — the committed, build-derived identity of the boot
 * closure. `bootSources` holds the SOURCE modules the boot chunks were built
 * from (not the hashed chunk names, which move on every renderer edit); see
 * `scripts/boot-manifest.ts` and #2137. A module that becomes boot-reachable is
 * checked by the next run without anyone remembering to add it.
 *
 * Subpaths resolve through the `exports` map in `packages/ui/package.json` — the
 * same map the bundler reads — so no path is hard-coded here.
 *
 * No build and no network: `boot-manifest.json` is committed, and the check is a
 * statement-level specifier scan over the sources it names, so this runs in a
 * plain `bun test`. Keeping the manifest equal to a real renderer build is
 * `bun run scripts/boot-manifest.ts --check --no-build`, run by CI in
 * `.github/workflows/bundle-size.yml` right after the renderer build.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const rendererDir = join(import.meta.dir, '..')
/** Repository root: `<root>/apps/electron/src/renderer` → up four. Manifest paths are relative to it. */
const repoRoot = join(rendererDir, '../../../..')

const BARREL = '@rox/ui'
/** The workspace package whose `exports` map subpaths resolve through. */
const UI_PACKAGE_DIR = 'packages/ui'

/** The committed boot closure. Structural subset of `BootManifest` in `scripts/boot-manifest.ts`. */
interface BootManifest {
  version: 1
  generator: string
  bootSources: string[]
  routes: Record<string, { sources: string[] }>
}

/** The part of `packages/ui/package.json` this guard resolves leaf paths against. */
interface UiPackageJson {
  exports: Record<string, string | Record<string, string>>
}

const manifest = JSON.parse(readFileSync(join(rendererDir, 'boot-manifest.json'), 'utf8')) as BootManifest

/** Entry modules that are boot by construction, whatever the manifest says. */
const BOOT_ENTRIES = ['apps/electron/src/renderer/bootstrap.ts', 'apps/electron/src/renderer/main.tsx']

/** A module that can carry an import. The closure also names assets (`.png`). */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/

/**
 * Statement-level static import / `export … from` specifiers, capturing the
 * clause between the keyword and `from` (e.g. ` * `, ` { a, b } `,
 * ` type { T } `) and the specifier itself.
 *
 * `[^;'"]*?` between the keyword and `from` keeps the match from crossing a
 * string literal, so `export const hint = t("from '@rox/ui'")` cannot be read as
 * an import. Dynamic `import('…')` is deliberately not matched — it produces a
 * separate async chunk instead of putting the module in the closure this guard
 * covers (see the residual-risk note in the PR body).
 */
const STATIC_SPECIFIER =
  /^[ \t]*(?:import|export)\b([^;'"]*?)\bfrom[ \t]*(['"])([^'"]+)\2|^[ \t]*import[ \t]*(['"])([^'"]+)\4/gm

/**
 * Statement-level `export … from '…'` re-exports. Clauses are read the same way
 * as in `STATIC_SPECIFIER`; only `export` matches, so a module that merely
 * *imports* other modules is still a leaf.
 */
const REEXPORT_FROM = /^[ \t]*export\b([^;'"]*?)\bfrom[ \t]*(['"])([^'"]+)\2/gm

/**
 * Static specifiers that survive to RUNTIME — i.e. statements the bundler cannot
 * erase. `import type { T } from '…'`, `export type { T } from '…'` and all-type
 * specifier lists (`import { type T } from '…'`) pull no module into the graph;
 * a mixed list (`import { type T, value } from '…'`) does.
 */
function runtimeSpecifiers(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(STATIC_SPECIFIER)) {
    const clause = match[1]
    // No clause group → bare `import '…'` (side-effect import), always runtime.
    if (clause === undefined || !isTypeOnlyClause(clause.trim())) out.push((match[3] ?? match[5]) as string)
  }
  return out
}

function readSource(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

/**
 * Is this `import` / `export … from` clause type-only? `type { … }`, `type *`,
 * `type * as ns` and all-`type`-prefixed specifier lists are erased by the
 * compiler and pull nothing into the runtime graph.
 */
function isTypeOnlyClause(clause: string): boolean {
  if (/^type\b/.test(clause)) return true
  if (!clause.startsWith('{')) return false
  const inner = clause.slice(1, clause.lastIndexOf('}'))
  const specifiers = inner.split(',').map((entry) => entry.trim()).filter(Boolean)
  return specifiers.length > 0 && specifiers.every((entry) => /^type\s/.test(entry))
}

/** Specifiers re-exported at RUNTIME — what makes a module an index rather than a leaf. */
function runtimeReexports(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(REEXPORT_FROM)) {
    if (!isTypeOnlyClause((match[1] ?? '').trim())) out.push(match[3] as string)
  }
  return out
}

/** Repository-relative path of the module a `@rox/ui[/subpath]` specifier resolves to, via the package `exports` map. */
function resolveSpecifierTarget(uiExports: UiPackageJson['exports'], specifier: string): string | null {
  // `@rox/ui` is the `.` key; `@rox/ui/chat/TurnCard` is `./chat/TurnCard`.
  const key = specifier === BARREL ? '.' : `.${specifier.slice(BARREL.length)}`
  const target = uiExports[key]
  const relative = typeof target === 'string' ? target : pickConditionalTarget(target)
  if (!relative) return null
  return `${UI_PACKAGE_DIR}/${relative.replace(/^\.\//, '')}`
}

/** Conditional `exports` entries (`{ import, default }`) — take the runtime branch, never `types`. */
function pickConditionalTarget(target: string | Record<string, string> | undefined): string | null {
  if (!target || typeof target !== 'object') return null
  for (const condition of ['import', 'module', 'default', 'require'] as const) {
    const value = target[condition]
    if (typeof value === 'string') return value
  }
  return null
}

/** Third-party modules cannot import the workspace `@rox/ui` alias, so only first-party code is scanned. */
const bootSources = manifest.bootSources ?? []
const firstParty = bootSources.filter((source) => SOURCE_FILE.test(source) && !source.includes('node_modules/'))

/**
 * Boot-reachable files that are ALLOWED to keep the barrel, each with its
 * reason. Empty today: every first-party module in the closure reaches
 * `@rox/ui` through a leaf subpath.
 *
 * An entry here is a load-bearing decision, not a place to park an accidental
 * importer — the `allow-list` test below fails on an entry that is no longer a
 * boot source or no longer imports the barrel, so this list cannot rot the way
 * `BOOT_BARREL_FILES` did. Checked against git history: the 26 files the old
 * list named were not exceptions, they were the set converted to leaf paths in
 * 052cd2ea0, so none of them needs to come back here.
 */
const ALLOWED_BARREL_IMPORTS: readonly { file: string; reason: string }[] = []

/**
 * `@rox/ui` subpaths the boot closure may keep importing even though they resolve
 * to a re-export index. Keyed by subpath, not by importer: whether a subpath is
 * an index is a property of `packages/ui`, not of the file that imports it, so
 * one entry covers every consumer — and the anti-rot checks below fail the moment
 * the entry stops describing reality.
 */
const ALLOWED_INDEX_SUBPATHS: readonly { subpath: string; reason: string }[] = [
  {
    subpath: '@rox/ui/context',
    reason: [
      'Resolves to packages/ui/src/context/index.ts — a 25-line aggregator whose',
      'three runtime re-exports (PlatformContext, ShikiThemeContext,',
      'OverlayPortalContext) import nothing but `react`, which the boot graph already',
      'has. The root barrel (packages/ui/src/index.ts: 344 lines, 18 `export … from`',
      'statements) is not comparable: it drags motion/framer-motion, radix, markdown,',
      'chat and terminal into the preloaded entry chunk. Keeping this aggregator adds',
      'no new runtime dependency to that chunk, and `packages/ui/package.json` declares',
      'no per-provider subpath for its consumers to move to — this is the only key.',
    ].join(' '),
  },
]

interface BarrelViolation {
  kind: 'barrel'
  file: string
}

interface IndexViolation {
  kind: 'index'
  file: string
  specifier: string
  indexFile: string
}

function bootGraphViolations(): (BarrelViolation | IndexViolation)[] {
  const uiPackage = JSON.parse(readSource(`${UI_PACKAGE_DIR}/package.json`)) as UiPackageJson
  const violations: (BarrelViolation | IndexViolation)[] = []

  for (const file of firstParty) {
    for (const specifier of runtimeSpecifiers(readSource(file))) {
      if (specifier === BARREL) {
        if (!ALLOWED_BARREL_IMPORTS.some((entry) => entry.file === file)) violations.push({ kind: 'barrel', file })
        continue
      }
      if (!specifier.startsWith(`${BARREL}/`)) continue
      if (ALLOWED_INDEX_SUBPATHS.some((entry) => entry.subpath === specifier)) continue
      const target = resolveSpecifierTarget(uiPackage.exports, specifier)
      // An undeclared or non-source specifier is not a leaf question; the
      // `declared package export` test below reports those.
      if (!target || !SOURCE_FILE.test(target) || !existsSync(join(repoRoot, target))) continue
      if (runtimeReexports(readSource(target)).length > 0) {
        violations.push({ kind: 'index', file, specifier, indexFile: target })
      }
    }
  }

  return violations
}

function bootGraphViolationMessage(violations: readonly (BarrelViolation | IndexViolation)[]): string {
  const lines = [
    `${violations.length} boot-reachable first-party import(s) pull a re-export INDEX into the preloaded graph:`,
    '',
  ]
  for (const violation of violations) {
    if (violation.kind === 'barrel') {
      lines.push(
        `  ${violation.file}`,
        `    imports \`${BARREL}\` → ${UI_PACKAGE_DIR}/src/index.ts (the root barrel)`,
      )
    } else {
      lines.push(
        `  ${violation.file}`,
        `    imports \`${violation.specifier}\` → ${violation.indexFile} (re-export index, not a leaf)`,
      )
    }
  }
  lines.push(
    '',
    'A leaf is a module with no runtime `export * from` and no runtime `export { … } from` —',
    'import the subpath the symbol is implemented in (see the `./<subpath>` keys in',
    `\`${UI_PACKAGE_DIR}/package.json\`), or split the aggregator into one. A subpath that must`,
    'stay an aggregator belongs in `ALLOWED_INDEX_SUBPATHS` with a reason.',
    "The root barrel evaluates every primitive it re-exports, which is what drags",
    "motion/radix into index.html's preloaded graph; an index subpath does the same on a smaller scale.",
  )
  return lines.join('\n')
}

describe('boot-reachable first-party code does not pull a @rox/ui re-export index', () => {
  it('boot-manifest.json is a source-level closure, not a list of chunk hashes', () => {
    // Anti-vacuity: an empty or renamed field, or a manifest that went back to
    // hashed chunk names (#2137), would leave the checks below scanning nothing.
    expect(manifest.version).toBe(1)
    expect(bootSources.length).toBeGreaterThan(500)
    expect(firstParty.length).toBeGreaterThan(300)

    const unrecognised = bootSources.filter((source) => !/^(?:apps|packages|node_modules)\//.test(source))
    expect(unrecognised).toEqual([])

    for (const entry of BOOT_ENTRIES) expect(bootSources).toContain(entry)
    // The barrel module itself is not in the closure today (`packages/ui/src/index.ts`
    // is re-export-only, so the bundler emits no code of its own for it) — this is
    // the build-level form of the invariant, the scan below is the reliable one.
    expect(bootSources).not.toContain('packages/ui/src/index.ts')

    // A manifest that names files this tree does not have is stale, and a stale
    // manifest silently shrinks the set the guard below scans.
    const missing = firstParty.filter((source) => !existsSync(join(repoRoot, source)))
    if (missing.length > 0) {
      throw new Error(
        [
          'boot-manifest.json names first-party files that are not in this tree:',
          ...missing.map((file) => `  - ${file}`),
          '',
          'Regenerate it against a renderer build: `ROX_RENDERER_SOURCEMAP=1 bun run electron:build:renderer`',
          '(CI: `.github/workflows/bundle-size.yml`).',
        ].join('\n'),
      )
    }
  })

  it('no boot file imports the barrel or a subpath that resolves to an index', () => {
    expect(firstParty.length).toBeGreaterThan(300)
    const violations = bootGraphViolations()
    if (violations.length > 0) throw new Error(bootGraphViolationMessage(violations))
  })

  it('every @rox/ui subpath a boot file imports is a declared package export', () => {
    const uiPackage = JSON.parse(readSource(`${UI_PACKAGE_DIR}/package.json`)) as UiPackageJson
    const declared = new Set(Object.keys(uiPackage.exports).map((key) => key.replace(/^\./, '')))
    const used = new Set<string>()
    for (const file of firstParty) {
      for (const specifier of runtimeSpecifiers(readSource(file))) {
        if (specifier.startsWith(`${BARREL}/`)) used.add(specifier.slice(BARREL.length))
      }
    }
    // Anti-vacuity: boot code does reach `@rox/ui` through leaf paths.
    expect(used.size).toBeGreaterThan(0)

    const undeclared = [...used].filter((subpath) => !declared.has(subpath)).sort()
    if (undeclared.length > 0) {
      throw new Error(
        [
          'boot-reachable code imports @rox/ui subpaths that `packages/ui/package.json` does not export:',
          ...undeclared.map((subpath) => `  - @rox/ui${subpath}`),
          '',
          'Add the subpath to the package `exports` map (this is what the bundler resolves).',
        ].join('\n'),
      )
    }
  })

  it('every @rox/ui subpath a boot file imports resolves to a real module', () => {
    // Anti-vacuity for the index check above: if `exports` values stopped being
    // resolvable, `bootGraphViolations` would silently skip every subpath.
    const uiPackage = JSON.parse(readSource(`${UI_PACKAGE_DIR}/package.json`)) as UiPackageJson
    const checked = new Set<string>()
    for (const file of firstParty) {
      for (const specifier of runtimeSpecifiers(readSource(file))) {
        if (specifier === BARREL || !specifier.startsWith(`${BARREL}/`)) continue
        checked.add(specifier)
      }
    }
    expect(checked.size).toBeGreaterThan(0)

    const unresolved = [...checked]
      .filter((specifier) => {
        const target = resolveSpecifierTarget(uiPackage.exports, specifier)
        return (
          target !== null && SOURCE_FILE.test(target) && !existsSync(join(repoRoot, target))
        )
      })
      .sort()
    if (unresolved.length > 0) {
      throw new Error(
        [
          'these @rox/ui subpaths are declared in `packages/ui/package.json` but resolve to files that do not exist:',
          ...unresolved.map((specifier) => `  - ${specifier}`),
          '',
          'Fix the `exports` target — the index check skips unresolvable subpaths.',
        ].join('\n'),
      )
    }
  })

  it('the index allow-list cannot rot: every entry is live, still an index, and carries a reason', () => {
    const uiPackage = JSON.parse(readSource(`${UI_PACKAGE_DIR}/package.json`)) as UiPackageJson
    const usedSubpaths = new Set<string>()
    for (const file of firstParty) {
      for (const specifier of runtimeSpecifiers(readSource(file))) {
        if (specifier.startsWith(`${BARREL}/`)) usedSubpaths.add(specifier)
      }
    }

    const unused = ALLOWED_INDEX_SUBPATHS.filter((entry) => !usedSubpaths.has(entry.subpath)).map(
      (entry) => entry.subpath,
    )
    if (unused.length > 0) {
      throw new Error(
        [
          'these allow-list subpaths are no longer imported by boot-reachable code, so the exception is dead weight:',
          ...unused.map((subpath) => `  - ${subpath}`),
          '',
          'Delete them from ALLOWED_INDEX_SUBPATHS.',
        ].join('\n'),
      )
    }

    const notAnIndex = ALLOWED_INDEX_SUBPATHS.filter((entry) => {
      const target = resolveSpecifierTarget(uiPackage.exports, entry.subpath)
      if (!target || !SOURCE_FILE.test(target) || !existsSync(join(repoRoot, target))) return true
      return runtimeReexports(readSource(target)).length === 0
    }).map((entry) => entry.subpath)
    if (notAnIndex.length > 0) {
      throw new Error(
        [
          'these allow-list subpaths no longer resolve to an index, so the exception should be deleted:',
          ...notAnIndex.map((subpath) => `  - ${subpath}`),
          '',
          'Delete them from ALLOWED_INDEX_SUBPATHS — they are leaf modules now.',
        ].join('\n'),
      )
    }

    for (const entry of ALLOWED_INDEX_SUBPATHS) {
      expect(entry.reason.trim().length).toBeGreaterThan(20)
    }
  })

  it('the barrel allow-list cannot rot: every entry is live and carries a reason', () => {
    const stale = ALLOWED_BARREL_IMPORTS.filter((entry) => !bootSources.includes(entry.file)).map(
      (entry) => entry.file,
    )
    if (stale.length > 0) {
      throw new Error(
        [
          'these allow-list entries are no longer boot-reachable, so the exception is dead weight:',
          ...stale.map((file) => `  - ${file}`),
          '',
          'Delete them from ALLOWED_BARREL_IMPORTS.',
        ].join('\n'),
      )
    }

    const resolved = ALLOWED_BARREL_IMPORTS.filter(
      (entry) => !runtimeSpecifiers(readSource(entry.file)).includes(BARREL),
    ).map((entry) => entry.file)
    if (resolved.length > 0) {
      throw new Error(
        [
          'these allow-list entries no longer import the barrel, so the exception should be deleted:',
          ...resolved.map((file) => `  - ${file}`),
          '',
          'Delete them from ALLOWED_BARREL_IMPORTS — they are on leaf paths now.',
        ].join('\n'),
      )
    }

    for (const entry of ALLOWED_BARREL_IMPORTS) {
      expect(entry.reason.trim().length).toBeGreaterThan(20)
    }
  })
})
