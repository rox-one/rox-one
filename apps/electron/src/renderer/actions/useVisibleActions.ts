/**
 * W1-07 (#1504) — flag-aware shortcut catalogue for the shortcut pages.
 *
 * Flag-gated actions (⌘J, ⌘⇧J, ⌃1…4, find in doc) appear — and are
 * rebindable through the registry overrides — once their flag is on. With
 * every flag off this equals the static `actionsByCategory` (baseline).
 */
import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { enabledShellFlagsAtom } from '@/platform/unified-flags'
import { actions } from './definitions'
import { actionsByCategoryFor } from './hotkeys'
import type { ActionDefinition } from './types'

const ALL_ACTIONS = Object.values(actions) as ActionDefinition[]

export function useActionsByCategory(): Record<string, ActionDefinition[]> {
  const flags = useAtomValue(enabledShellFlagsAtom)
  return useMemo(() => actionsByCategoryFor(ALL_ACTIONS, flags), [flags])
}
