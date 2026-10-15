/**
 * Boot-closure guard: no first-party module in `index.html`'s preloaded graph may
 * import the `@rox/ui` barrel.
 *
 * Evaluating the barrel pulls every primitive it re-exports — `Island` →
 * `motion`/`framer-motion`, `BrowserControls`, `StyledDropdown`, `Spinner` — into
 * the shared chunk the entry page preloads. Leaf paths (`@rox/ui/tooltip`,
 * `@rox/ui/spinner`, `@rox/ui/markdown`, …) skip it. See
 * `docs/perf/boot-closure-wave-2026-10-15.md`.
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

/** The committed boot closure. Structural subset of `BootManifest` in `scripts/boot-manifest.ts`. */
interface BootManifest {
  version: 1
  generator: string
  bootSources: string[]
  routes: Record<string, { sources: string[] }>
}

/** The part of `packages/ui/package.json` this guard resolves leaf paths against. */
interface UiPackageJson {
  exports: Record<string, string>
}

const manifest = JSON.parse(readFileSync(join(rendererDir, 'boot-manifest.json'), 'utf8')) as BootManifest

/** Entry modules that are boot by construction, whatever the manifest says. */
const BOOT_ENTRIES = ['apps/electron/src/renderer/bootstrap.ts', 'apps/electron/src/renderer/main.tsx']

/** A module that can carry an import. The closure also names assets (`.png`). */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/

/**
 * Statement-level static import / `export … from` specifiers.
 *
 * `[^;'"]*?` between the keyword and `from` keeps the match from crossing a
 * string literal, so `export const hint = t("from '@rox/ui'")` cannot be read as
 * an import. Dynamic `import('…')` is deliberately not matched — it produces a
 * separate async chunk instead of putting the module in the closure this guard
 * covers (see the residual-risk note in the PR body).
 */
const STATIC_SPECIFIER = /^[ \t]*(?:import|export)\b[^;'"]*?\bfrom[ \t]*(['"])([^'"]+)\1|^[ \t]*import[ \t]*(['"])([^'"]+)\3/gm

function staticSpecifiers(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(STATIC_SPECIFIER)) out.push((match[2] ?? match[4]) as string)
  return out
}

function readSource(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

function importsBarrel(rel: string): boolean {
  return staticSpecifiers(readSource(rel)).includes(BARREL)
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

const allowed = new Set(ALLOWED_BARREL_IMPORTS.map((entry) => entry.file))

function barrelViolationMessage(offenders: readonly string[]): string {
  return [
    `${offenders.length} boot-reachable first-party file(s) import the \`${BARREL}\` barrel:`,
    ...offenders.map((file) => `  - ${file}`),
    '',
    `Import the leaf subpath the symbol lives in (\`@rox/ui/tooltip\`, \`@rox/ui/spinner\`,`,
    '`@rox/ui/markdown`, `@rox/ui/dropdown-menu`, `@rox/ui/context`, …) — see the',
    '`./<subpath>` keys in `packages/ui/package.json`. The barrel evaluates every primitive it',
    "re-exports, which is what drags motion/radix into index.html's preloaded graph.",
  ].join('\n')
}

describe('boot-reachable first-party code does not import the @rox/ui barrel', () => {
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

  it('no boot file imports the barrel — the set is derived from the manifest', () => {
    expect(firstParty.length).toBeGreaterThan(300)
    const offenders = firstParty.filter((file) => !allowed.has(file) && importsBarrel(file))
    if (offenders.length > 0) throw new Error(barrelViolationMessage(offenders))
  })

  it('every @rox/ui subpath a boot file imports is a declared package export', () => {
    const uiPackage = JSON.parse(readSource('packages/ui/package.json')) as UiPackageJson
    const declared = new Set(Object.keys(uiPackage.exports).map((key) => key.replace(/^\./, '')))
    const used = new Set<string>()
    for (const file of firstParty) {
      for (const specifier of staticSpecifiers(readSource(file))) {
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

    const resolved = ALLOWED_BARREL_IMPORTS.filter((entry) => !importsBarrel(entry.file)).map(
      (entry) => entry.file,
    )
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
