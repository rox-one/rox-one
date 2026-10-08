/**
 * W1-07 (#1504) — the jotai store the W1-07 shell gates read outside React.
 *
 * main.tsx mounts `<JotaiProvider>` without a store prop (unchanged from the
 * baseline), so React state lives in the Provider's own store, not in
 * `getDefaultStore()`. Module-level W1-07 readers (route gate bridge, keydown
 * flag gate, mode-aware takeovers, `messengerActive`, the Omnibox shell-flag
 * and entity providers) must read that same store, or a runtime flag flip
 * updates the UI but not the gates.
 *
 * `<ShellStoreBridge />` (rendered once inside the Provider) connects it.
 * Until then — and in tests / the playground — readers fall back to
 * `getDefaultStore()`. Pre-existing baseline readers (Omnibox sessions /
 * skills / conation) deliberately keep using `getDefaultStore()`.
 */
import { getDefaultStore } from 'jotai'

export type ShellStore = ReturnType<typeof getDefaultStore>

let connected: ShellStore | null = null

/** The Provider store once connected, else the default store. */
export function getShellStore(): ShellStore {
  return connected ?? getDefaultStore()
}

/** Connect `store` (null disconnects → default store again). */
export function setShellStore(store: ShellStore | null): void {
  connected = store
}

export function isShellStoreConnected(store: ShellStore): boolean {
  return connected === store
}
