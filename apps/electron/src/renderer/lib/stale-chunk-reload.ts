/**
 * Stale-chunk recovery (openclaw-port row b1.2).
 *
 * After an update the renderer can be holding an index/entry that points at
 * chunk filenames the new build no longer serves; the dynamic import then
 * rejects with "Failed to fetch dynamically imported module" (or Vite fires
 * `vite:preloadError`). A single hard reload fetches the fresh index and heals
 * it. Reloading on *every* such failure would loop forever when the network is
 * genuinely down, so the guard is once per session: a module-scoped flag for
 * the current page plus a `sessionStorage` marker that survives the reload and
 * therefore blocks a second attempt on the boot after it.
 *
 * The error patterns are deliberately narrow — an unrelated rejection must not
 * reload the window — while `vite:preloadError` is trusted as-is (Vite only
 * fires it for a preload/chunk failure).
 */

/** sessionStorage key marking "this session already reloaded once". */
export const STALE_CHUNK_RELOAD_KEY = 'rox:stale-chunk-reload'

/**
 * Browser/Vite messages that mean "this chunk is gone", not an application bug.
 * Chrome/Electron, Firefox and Vite's own polyfill each phrase it differently.
 */
const CHUNK_LOAD_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed|Unable to preload (?:CSS|module)/i

const messageOf = (reason: unknown): string => {
  if (typeof reason === 'string') return reason
  if (reason instanceof Error) return reason.message
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    return reason.message
  }
  return ''
}

/** True when a rejection reason is a chunk-load failure we can heal by reloading. */
export function isChunkLoadRejection(reason: unknown): boolean {
  return CHUNK_LOAD_ERROR.test(messageOf(reason))
}

export interface StaleChunkReloadDeps {
  /** Perform the hard reload. */
  reload: () => void
  /** Read the persistent once-per-session guard (sessionStorage). */
  hasReloaded: () => boolean
  /** Persist the guard *before* reloading, so the next boot sees it. */
  markReloaded: () => void
  /** Override the chunk-error classifier (tests). */
  isChunkLoadError?: (reason: unknown) => boolean
}

export interface StaleChunkReloadHandle {
  /** Handle a rejection reason; true when this call triggered the reload. */
  handle: (reason: unknown) => boolean
  /** Handle `vite:preloadError` — a chunk failure by definition, reason ignored. */
  handlePreloadError: () => boolean
}

/**
 * Stateful one-shot guard. The first qualifying failure performs the reload and
 * every later call in this page (and the page after the reload, via
 * `hasReloaded`) is a no-op.
 */
export function createStaleChunkReload(deps: StaleChunkReloadDeps): StaleChunkReloadHandle {
  // Module-scoped half of the guard: the sessionStorage half survives the reload.
  let used = deps.hasReloaded()
  const isChunkLoadError = deps.isChunkLoadError ?? isChunkLoadRejection
  const trigger = (): boolean => {
    if (used) return false
    used = true
    deps.markReloaded()
    deps.reload()
    return true
  }
  return {
    handle(reason: unknown): boolean {
      if (reason !== undefined && !isChunkLoadError(reason)) return false
      return trigger()
    },
    handlePreloadError: trigger,
  }
}

function safeSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

/**
 * Wire the one-shot recovery into the window. Must run before the first
 * dynamic import that can outlive a build. Returns a disposer.
 */
export function installStaleChunkReload(target?: Window): () => void {
  const win = target ?? (typeof window === 'undefined' ? undefined : window)
  if (!win || typeof win.addEventListener !== 'function') return () => {}
  const storage = safeSessionStorage()
  const recovery = createStaleChunkReload({
    reload: () => win.location.reload(),
    hasReloaded: () => storage?.getItem(STALE_CHUNK_RELOAD_KEY) === '1',
    markReloaded: () => {
      try {
        storage?.setItem(STALE_CHUNK_RELOAD_KEY, '1')
      } catch {
        /* private-mode storage: the module flag still guards this page */
      }
    },
  })

  // `vite:preloadError` is fired only for a preload/chunk failure, so its
  // payload (an Error) is not re-classified — the event itself is the signal.
  const onPreloadError = (_event: Event): void => {
    recovery.handlePreloadError()
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (recovery.handle(event.reason)) event.preventDefault()
  }

  win.addEventListener('vite:preloadError', onPreloadError)
  win.addEventListener('unhandledrejection', onUnhandledRejection as EventListener)
  return () => {
    win.removeEventListener('vite:preloadError', onPreloadError)
    win.removeEventListener('unhandledrejection', onUnhandledRejection as EventListener)
  }
}