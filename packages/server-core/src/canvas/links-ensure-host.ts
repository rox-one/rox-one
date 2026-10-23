/**
 * Process-wide host for turning `entities.links.v1` on from agent canvas tools.
 * Electron registers `applyEntitiesLinksFlag(true)` here so the ensure path
 * matches the surface UI (durable copy + route gate + workbench flags +
 * renderer broadcast). Tests / headless fall back to publishing the flag into
 * the live workbench set only.
 */
import { ENTITIES_LINKS_WORKBENCH_FLAG } from '@rox/shared/feature-flags'
import {
  getEntitiesWorkbenchFlags,
  setEntitiesWorkbenchFlags,
} from '../entities/workbench-flags.ts'

export type CanvasLinksEnsure = () => void | Promise<void>

let host: CanvasLinksEnsure | null = null

/** Electron registers `() => applyEntitiesLinksFlag(true)` here. */
export function setCanvasLinksEnsureHost(next: CanvasLinksEnsure | null): void {
  host = next
}

/** Tests only. */
export function resetCanvasLinksEnsureHost(): void {
  host = null
}

async function fallbackEnsure(): Promise<void> {
  const current = getEntitiesWorkbenchFlags()
  if (current.has(ENTITIES_LINKS_WORKBENCH_FLAG)) return
  setEntitiesWorkbenchFlags([...current, ENTITIES_LINKS_WORKBENCH_FLAG])
}

/** Turn entities.links.v1 on (host path when registered, else in-process fallback). */
export async function ensureCanvasLinksEnabled(): Promise<void> {
  if (host) await host()
  else await fallbackEnsure()
}
