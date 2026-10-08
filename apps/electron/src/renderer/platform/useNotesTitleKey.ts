/**
 * W1-07 (#1504) — Notes is named «Документы» everywhere while
 * `docs.shared.v1` is on. Returns `baseKey` unchanged with the flag off.
 */
import { useAtomValue } from 'jotai'
import { notesTitleKey } from './surface-shell'
import { enabledShellFlagsAtom } from './unified-flags'

export function useNotesTitleKey(baseKey: string): string {
  return notesTitleKey(useAtomValue(enabledShellFlagsAtom), baseKey)
}
