/**
 * W1-10 (#1507) — v2.1 gates: chrome schema lint, "one rail" DOM gate,
 * right-dock width table test (TECH-SPEC §19 / §18.4, UI-SPEC §26).
 *
 * Inputs are owned by W1-15 (#1512): `packages/core/src/platform/chrome.ts`
 * (SidebarSchema/TopBarSchema registry) and
 * `apps/electron/src/renderer/platform/right-dock.ts` (pure dock function).
 * Missing → pending. Present but not importable / without the expected
 * export / wrong shape → FAIL (fail closed, see types.ts). Each gate
 * accepts injected fixtures for self-tests.
 *
 * Wiring contract for #1512 (any one name per row):
 * - chrome.ts: an array `CHROME_SCHEMAS` | `chromeSchemas` |
 *   `SURFACE_CHROME_SCHEMAS`, or a function `listChromeSchemas()` |
 *   `getChromeSchemas()`, of `{ surface, rightZone | right, centerControls | center }`
 *   (right-zone entries are ids or `{ id }`; `center` is an array or a single
 *   control). Optional `CHROME_SURFACES: string[]` = surfaces that must
 *   have a schema (UI-SPEC §26.2/§26.3).
 * - right-dock.ts: `computeDockMode` | `dockMode` | `resolveDockMode`
 *   `(width, sidebar, inspector, agent) => 'sideBySide' | 'sharedDock' | 'overlay'`,
 *   where `sidebar` is the PRE-collapse width and auto-collapse to 56 is
 *   tried before sharedDock (§18.4 "Order"; owner decision, review 2).
 *   A `{ mode }` object return is accepted too.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, pendingUntilBrowserDriver, inputBroken, errorMessage, gateFromViolations, type GateResult } from './types.ts'
import { buildDockTable, type DockMode } from '../fixtures/dock.ts'

export const CHROME_PATH = join('packages', 'core', 'src', 'platform', 'chrome.ts')
export const RIGHT_DOCK_PATH = join('apps', 'electron', 'src', 'renderer', 'platform', 'right-dock.ts')
export const CHROME_SCHEMA_EXPORTS = ['CHROME_SCHEMAS', 'chromeSchemas', 'SURFACE_CHROME_SCHEMAS'] as const
export const CHROME_SCHEMA_FACTORIES = ['listChromeSchemas', 'getChromeSchemas'] as const
export const DOCK_EXPORTS = ['computeDockMode', 'dockMode', 'resolveDockMode'] as const

export interface ChromeSchema {
  surface: string
  rightZone: string[]
  centerControls: number
}

type DockFn = (width: number, sidebar: number, inspector: number, agent: number) => DockMode | { mode: DockMode } | Promise<DockMode | { mode: DockMode }>

function defaultRoot(): string {
  return join(import.meta.dir, '..', '..', '..', '..')
}

export function lintChromeSchemas(schemas: ChromeSchema[], opts: { expectedSurfaces?: string[] } = {}): GateResult {
  const gate = 'chrome-schema-lint'
  const violations: string[] = []
  const seen = new Set<string>()
  for (const s of schemas) {
    if (seen.has(s.surface)) violations.push(`duplicate schema for surface '${s.surface}'`)
    seen.add(s.surface)
    if (s.centerControls > 1) violations.push(`surface '${s.surface}' has ${s.centerControls} center controls (max 1)`)
    const roxIndex = s.rightZone.lastIndexOf('@rox')
    if (s.rightZone.includes('@rox') && roxIndex !== s.rightZone.length - 1) {
      violations.push(`surface '${s.surface}': @rox must be last in the right zone`)
    }
  }
  for (const expected of opts.expectedSurfaces ?? []) {
    if (!seen.has(expected)) violations.push(`surface '${expected}' has no SidebarSchema/TopBarSchema`)
  }
  return gateFromViolations(gate, violations, `${schemas.length} surface schema(s) lint-clean`)
}

function zoneId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') return (entry as { id: string }).id
  return null
}

/** Normalise one exported schema into the lint shape, or explain why it can't be. */
export function normalizeChromeSchema(raw: unknown, index: number): ChromeSchema | string {
  if (!raw || typeof raw !== 'object') return `schema #${index} is not an object`
  const r = raw as Record<string, unknown>
  if (typeof r.surface !== 'string' || !r.surface) return `schema #${index} has no string 'surface'`
  const zone = r.rightZone ?? r.right
  if (!Array.isArray(zone)) return `surface '${r.surface}': no 'rightZone' / 'right' array`
  const rightZone = zone.map(zoneId)
  if (rightZone.some((id) => id === null)) return `surface '${r.surface}': right-zone entries must be ids or { id }`
  let centerControls: number
  if (typeof r.centerControls === 'number') centerControls = r.centerControls
  else if (Array.isArray(r.center)) centerControls = r.center.length
  else if ('center' in r) centerControls = r.center == null ? 0 : 1
  else return `surface '${r.surface}': no 'centerControls' number or 'center' control(s)`
  return { surface: r.surface, rightZone: rightZone as string[], centerControls }
}

export async function checkChromeLintGate(opts: { repoRoot?: string } = {}): Promise<GateResult> {
  const gate = 'chrome-schema-lint'
  const modPath = join(opts.repoRoot ?? defaultRoot(), CHROME_PATH)
  if (!existsSync(modPath)) return pending(gate, CHROME_PATH, '1512')
  let mod: Record<string, unknown>
  try {
    mod = (await import(modPath)) as Record<string, unknown>
  } catch (error) {
    return inputBroken(gate, CHROME_PATH, `import failed: ${errorMessage(error)}`)
  }
  let raw: unknown
  const arrayKey = CHROME_SCHEMA_EXPORTS.find((k) => Array.isArray(mod[k]))
  const factoryKey = CHROME_SCHEMA_FACTORIES.find((k) => typeof mod[k] === 'function')
  try {
    if (arrayKey) raw = mod[arrayKey]
    else if (factoryKey) raw = await (mod[factoryKey] as () => unknown)()
  } catch (error) {
    return inputBroken(gate, CHROME_PATH, `${factoryKey}() threw: ${errorMessage(error)}`)
  }
  if (raw === undefined) {
    return inputBroken(gate, CHROME_PATH, `exports none of ${[...CHROME_SCHEMA_EXPORTS, ...CHROME_SCHEMA_FACTORIES.map((f) => `${f}()`)].join(', ')}`)
  }
  if (!Array.isArray(raw) || raw.length === 0) return inputBroken(gate, CHROME_PATH, 'surface schema list is empty or not an array')
  const schemas: ChromeSchema[] = []
  const shapeErrors: string[] = []
  raw.forEach((item, i) => {
    const n = normalizeChromeSchema(item, i)
    if (typeof n === 'string') shapeErrors.push(n)
    else schemas.push(n)
  })
  if (shapeErrors.length > 0) return { gate, status: 'fail', summary: 'surface schemas have an unexpected shape', violations: shapeErrors.map((e) => `${CHROME_PATH}: ${e}`) }
  const expected = mod.CHROME_SURFACES
  if (expected !== undefined && !(Array.isArray(expected) && expected.every((s) => typeof s === 'string'))) {
    return inputBroken(gate, CHROME_PATH, 'CHROME_SURFACES must be a string[]')
  }
  return lintChromeSchemas(schemas, { expectedSurfaces: expected as string[] | undefined })
}

export function checkOneRailGate(html: string): GateResult {
  const gate = 'one-rail-dom'
  const matches = html.match(/<[^>]*\brole=["']navigation["'][^>]*\bdata-rail\b[^>]*>|<[^>]*\bdata-rail\b[^>]*\brole=["']navigation["'][^>]*>/gi) ?? []
  return gateFromViolations(
    gate,
    matches.length === 1 ? [] : [`expected exactly one rail element, found ${matches.length}`],
    'exactly one rail element',
  )
}

/** The rendered shell DOM only exists inside the wave-2 browser driver. */
export function checkOneRailGatePending(): GateResult {
  return pendingUntilBrowserDriver('one-rail-dom', 'the rendered shell HTML (#1512 surfaces)')
}

type DockDiscovery = { kind: 'absent' } | { kind: 'broken'; problem: string } | { kind: 'ok'; fn: DockFn }

async function discoverDockFn(repoRoot?: string): Promise<DockDiscovery> {
  const modPath = join(repoRoot ?? defaultRoot(), RIGHT_DOCK_PATH)
  if (!existsSync(modPath)) return { kind: 'absent' }
  let mod: Record<string, unknown>
  try {
    mod = (await import(modPath)) as Record<string, unknown>
  } catch (error) {
    return { kind: 'broken', problem: `import failed: ${errorMessage(error)}` }
  }
  const key = DOCK_EXPORTS.find((k) => typeof mod[k] === 'function')
  if (!key) return { kind: 'broken', problem: `exports none of ${DOCK_EXPORTS.join(', ')}` }
  return { kind: 'ok', fn: mod[key] as DockFn }
}

export async function checkDockLayoutGate(opts: { repoRoot?: string; computeMode?: DockFn } = {}): Promise<GateResult> {
  const gate = 'dock-layout'
  let compute = opts.computeMode
  if (!compute) {
    const found = await discoverDockFn(opts.repoRoot)
    if (found.kind === 'absent') return pending(gate, RIGHT_DOCK_PATH, '1512')
    if (found.kind === 'broken') return inputBroken(gate, RIGHT_DOCK_PATH, found.problem)
    compute = found.fn
  }

  const violations: string[] = []
  for (const row of buildDockTable()) {
    let got: DockMode
    try {
      const out = (await compute(row.width, row.sidebar, row.inspector, row.agent)) as DockMode | { mode?: DockMode }
      got = (typeof out === 'object' && out !== null ? out.mode : out) as DockMode
    } catch (error) {
      violations.push(`W=${row.width} S=${row.sidebar} I=${row.inspector} A=${row.agent}: threw ${errorMessage(error)}`)
      continue
    }
    if (got !== row.expected) {
      violations.push(`W=${row.width} S=${row.sidebar} I=${row.inspector} A=${row.agent}: got ${got}, want ${row.expected}${row.autoCollapsed ? ' (sidebar auto-collapsed first)' : ''}`)
    }
    if (got === 'sideBySide' && row.mainWidth < 640) {
      violations.push(`W=${row.width}: MAIN is ${row.mainWidth} (< 640)`)
    }
  }
  return gateFromViolations(gate, violations, `${buildDockTable().length} dock table row(s) hold, MAIN ≥ 640`)
}
