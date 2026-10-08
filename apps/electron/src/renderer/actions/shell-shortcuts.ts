/**
 * W1-07 (#1504) — mode-aware shortcut takeovers (UI-SPEC §15, v2.1 audit).
 *
 * A takeover lets a surface reuse a global chord while it applies, without a
 * second binding: the surface registers a higher-priority handler on the base
 * action (the Tasks ⌘N precedent). The registry already runs the first enabled
 * handler, highest priority first.
 *
 * ⌘F: `app.search` everywhere; in Docs (flag `docs.shared.v1`) the open
 * document's find (`docs.findInDoc`). Lark's Docs ⌘J moved here because ⌘J is
 * the agent panel.
 */
import { getDefaultStore } from 'jotai'
import { enabledShellFlagsAtom } from '@/platform/unified-flags'
import { actions, type ActionId } from './definitions'
import { useAction } from './useAction'
import type { ActionDefinition } from './types'

export interface ModeAwareTakeover {
  chord: string
  baseActionId: ActionId
  takeoverActionId: ActionId
  /** Handler priority on the base action (Tasks ⌘N uses 10). */
  priority: number
}

export const MODE_AWARE_TAKEOVERS: readonly ModeAwareTakeover[] = [
  { chord: 'mod+f', baseActionId: 'app.search', takeoverActionId: 'docs.findInDoc', priority: 20 },
]

export function takeoverFor(takeoverActionId: ActionId): ModeAwareTakeover | undefined {
  return MODE_AWARE_TAKEOVERS.find((entry) => entry.takeoverActionId === takeoverActionId)
}

/** True when the takeover's action flag is on (pure; flags passed in). */
export function isTakeoverActive(takeover: ModeAwareTakeover, flags: ReadonlySet<string>): boolean {
  const flag = (actions[takeover.takeoverActionId] as ActionDefinition).flag
  return !flag || flags.has(flag)
}

/**
 * For the surface that owns a takeover (e.g. the Docs editor in wave 2):
 * binds `handler` to the takeover action (Omnibox) and to the base chord while
 * the flag is on and `applies()` holds; otherwise the base action runs.
 */
export function useModeAwareTakeover(
  takeoverActionId: ActionId,
  handler: () => void,
  applies: () => boolean,
  deps: unknown[] = [],
): void {
  const takeover = takeoverFor(takeoverActionId)
  if (!takeover) throw new Error(`No mode-aware takeover declared for ${takeoverActionId}`)
  const active = () => isTakeoverActive(takeover, getDefaultStore().get(enabledShellFlagsAtom)) && applies()
  useAction(takeover.takeoverActionId, handler, { enabled: active }, deps)
  useAction(takeover.baseActionId, handler, { enabled: active, priority: takeover.priority }, deps)
}
