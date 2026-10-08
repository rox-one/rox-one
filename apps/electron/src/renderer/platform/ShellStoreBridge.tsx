/**
 * W1-07 (#1504) — connects the `<JotaiProvider>` store to the W1-07 gates
 * that run outside React (see `shell-store.ts`). Render once, inside the
 * Provider and before the app, so its layout effect runs first.
 */
import { useLayoutEffect } from 'react'
import { useStore } from 'jotai'
import { connectShellStore } from './unified-flags'

export function ShellStoreBridge(): null {
  const store = useStore()
  useLayoutEffect(() => connectShellStore(store), [store])
  return null
}
