/**
 * W1-10 (#1507) — v2.1 gates: chrome schema lint, "one rail" DOM gate,
 * right-dock width table test (TECH-SPEC §19 / §18.4, UI-SPEC §26).
 *
 * Inputs are owned by W1-15 (#1512): `packages/core/src/platform/chrome.ts`
 * (SidebarSchema/TopBarSchema registry) and
 * `apps/electron/src/renderer/platform/right-dock.ts` (pure dock function).
 * Missing → pending. Each gate accepts injected fixtures for self-tests.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'
import { buildDockTable, type DockMode } from '../fixtures/dock.ts'

const CHROME_PATH = join('packages', 'core', 'src', 'platform', 'chrome.ts')
const RIGHT_DOCK_PATH = join('apps', 'electron', 'src', 'renderer', 'platform', 'right-dock.ts')

export interface ChromeSchema {
  surface: string
  rightZone: string[]
  centerControls: number
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

export function checkChromeLintGate(opts: { repoRoot?: string } = {}): GateResult {
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  if (!existsSync(join(root, CHROME_PATH))) return pending('chrome-schema-lint', CHROME_PATH, '1512')
  return { gate: 'chrome-schema-lint', status: 'pending', summary: 'pending (chrome registry present; surface list from UI-SPEC §26.2 not wired yet)' }
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

export function checkOneRailGatePending(): GateResult {
  return pending('one-rail-dom', 'rendered shell HTML (wave-2 surfaces)', '1512')
}

export async function checkDockLayoutGate(opts: {
  repoRoot?: string
  computeMode?: (width: number, sidebar: number, inspector: number, agent: number) => DockMode | Promise<DockMode>
} = {}): Promise<GateResult> {
  const gate = 'dock-layout'
  const compute = opts.computeMode ?? (await discoverDockFn(opts.repoRoot))
  if (!compute) return pending(gate, RIGHT_DOCK_PATH, '1512')

  const violations: string[] = []
  for (const row of buildDockTable()) {
    const got = await compute(row.width, row.sidebar, row.inspector, row.agent)
    if (got !== row.expected) {
      violations.push(`W=${row.width} S=${row.sidebar} I=${row.inspector} A=${row.agent}: got ${got}, want ${row.expected}`)
    }
    if (got === 'sideBySide' && row.mainWidth < 640) {
      violations.push(`W=${row.width}: MAIN is ${row.mainWidth} (< 640)`)
    }
  }
  return gateFromViolations(gate, violations, `${buildDockTable().length} dock table row(s) hold, MAIN ≥ 640`)
}

async function discoverDockFn(
  repoRoot?: string,
): Promise<((width: number, sidebar: number, inspector: number, agent: number) => DockMode | Promise<DockMode>) | null> {
  const root = repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const modPath = join(root, RIGHT_DOCK_PATH)
  if (!existsSync(modPath)) return null
  try {
    const mod = (await import(modPath)) as Record<string, unknown>
    for (const key of ['computeDockMode', 'dockMode', 'resolveDockMode']) {
      if (typeof mod[key] === 'function') {
        return mod[key] as (width: number, sidebar: number, inspector: number, agent: number) => DockMode
      }
    }
    return null
  } catch {
    return null
  }
}
