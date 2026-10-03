import { useCallback } from 'react'
import { useStore } from 'jotai'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { focusedPanelIdAtom } from '@/atoms/panel-stack'
import { panelOwnsKeyboardTarget } from './panel-keyboard'

/** Reads atom focus at event time so a late render cannot authorize another pane. */
export function usePanelKeyboardGuard() {
  const store = useStore()
  const panelId = useOptionalAppShellContext()?.panelId
  return useCallback((target: EventTarget | null) => panelOwnsKeyboardTarget(panelId, store.get(focusedPanelIdAtom), target), [panelId, store])
}
