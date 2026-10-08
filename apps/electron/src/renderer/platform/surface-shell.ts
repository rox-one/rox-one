/**
 * W1-07 (#1504) — pure shell helpers shared by AppShell, the mode pill, the
 * mode hotkeys and the surface tab titles, so every place that shows a mode
 * (title, Docs relabel, order) reads the same resolved list.
 */
import { WORKBENCH_FLAG, type ModeContribution, type ModeRegistry } from '@rox/core/platform'
import type { ModeScreenFlags } from '@/atoms/mode-flags'
import type { UnifiedSurfaceId } from '../../shared/surface-routes'
import { DOCS_RELABEL_TITLE_KEY, resolveSeededModes } from './modes-seed'
import { flagContextKeys } from './unified-flags'

/** Modes of the pill / ⌘1…7: flag-gated `when`s, mode-screen flags, relabels. */
export function listShellModes(
  registry: ModeRegistry,
  modeFlags: Partial<ModeScreenFlags>,
  shellFlags: ReadonlySet<string>,
): ModeContribution[] {
  return resolveSeededModes(registry.list(flagContextKeys(shellFlags)), modeFlags, shellFlags)
}

/** Header / tab title key of a unified mode root. */
export function surfaceTitleKey(surface: UnifiedSurfaceId): string {
  return `workbench.mode.${surface}`
}

/** Notes → «Документы» wherever Notes is named while `docs.shared.v1` is on. */
export function notesTitleKey(shellFlags: ReadonlySet<string>, baseKey: string): string {
  return shellFlags.has(WORKBENCH_FLAG.docsSharedV1) ? DOCS_RELABEL_TITLE_KEY : baseKey
}

export interface RouteTitleSources {
  destinations: ReadonlyArray<{ route?: (() => string) | null; labelKey: string }>
  modes: readonly ModeContribution[]
  extraScreens: ReadonlyArray<{ id: string; labelKey: string }>
}

/** Route root → title key (nav destinations < modes < «Ещё» screens). */
export function buildRouteTitleKeys({ destinations, modes, extraScreens }: RouteTitleSources): Map<string, string> {
  const map = new Map<string, string>()
  const root = (route: string) => route.split('?')[0]!.split('/')[0]!
  for (const dest of destinations) {
    if (dest.route) map.set(root(dest.route()), dest.labelKey)
  }
  for (const mode of modes) {
    if (mode.rootRoute) map.set(root(mode.rootRoute), mode.titleKey)
  }
  for (const screen of extraScreens) map.set(screen.id, screen.labelKey)
  return map
}
