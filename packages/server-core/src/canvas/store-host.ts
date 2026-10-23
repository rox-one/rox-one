/**
 * Process-wide CanvasFileStore host so agent tools and Electron canvas IPC
 * share one store per workspace root (the file-store lock forbids two stores
 * on the same root in one process).
 */
import { CanvasFileStore } from '@rox/canvas-core/node'

export interface CanvasFileStoreHost {
  /** Return the live store for this workspace root (create once, reuse). */
  forRoot(workspaceRoot: string): CanvasFileStore
}

let host: CanvasFileStoreHost | null = null
const fallback = new Map<string, CanvasFileStore>()

/** Electron `registerCanvasIpc` registers its registry here. */
export function setCanvasFileStoreHost(next: CanvasFileStoreHost | null): void {
  host = next
}

/** Tests only. */
export function resetCanvasFileStoreHost(): void {
  host = null
  for (const store of fallback.values()) {
    try { void store.flush() } catch { /* ignore */ }
  }
  fallback.clear()
}

export function canvasFileStoreFor(workspaceRoot: string): CanvasFileStore {
  if (host) return host.forRoot(workspaceRoot)
  let store = fallback.get(workspaceRoot)
  if (!store) {
    store = new CanvasFileStore(workspaceRoot)
    fallback.set(workspaceRoot, store)
  }
  return store
}
