/**
 * Cookbooks IPC handlers (SPEC §Amendment 1, §IPC).
 *
 * Thin registry over the process-wide `CookbooksRuntime` singleton (lifecycle
 * owned by main/index.ts). Main is the only HTTP client of the sidecar: the
 * renderer only ever sees the typed status and the document DTOs — the loopback
 * URL and the bearer token never cross this boundary.
 *
 * All channels are LOCAL_ONLY (routing.ts).
 */
import { RPC_CHANNELS } from '@rox/shared/protocol/channels'
import type {CookbooksStatus} from '../../shared/types'
import type {
  CookbooksMutateInput,
  CookbooksRunAllStreamInput,
  CookbooksRunStreamEvent,
  CookbooksRunStreamInput,
} from '../../shared/cookbooks'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { getCookbooksRuntime, initializeCookbooksRuntime } from '../cookbooks-runtime'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.cookbooksLab.ENSURE,
  RPC_CHANNELS.cookbooksLab.STATUS,
  RPC_CHANNELS.cookbooksLab.RESTART,
  RPC_CHANNELS.cookbooksLab.CATALOG,
  RPC_CHANNELS.cookbooksLab.OPEN,
  RPC_CHANNELS.cookbooksLab.DOCUMENT,
  RPC_CHANNELS.cookbooksLab.RUN,
  RPC_CHANNELS.cookbooksLab.RUN_ALL,
  // Wave 15: fast stream starts — they resolve `{runId}` as soon as the sidecar
  // accepts the run, so a long run never hits the 60 s transport ceiling.
  RPC_CHANNELS.cookbooksLab.RUN_STREAM,
  RPC_CHANNELS.cookbooksLab.RUN_ALL_STREAM,
  RPC_CHANNELS.cookbooksLab.SAVE,
  RPC_CHANNELS.cookbooksLab.RESET,
  RPC_CHANNELS.cookbooksLab.CANCEL,
  RPC_CHANNELS.cookbooksLab.EXPORT,
  // Wave 10: structural cell mutations (add/delete/move/duplicate).
  RPC_CHANNELS.cookbooksLab.MUTATE,
] as const

function statusKey(status: CookbooksStatus): string {
  return `${status.state}:${status.reason ?? ''}:${status.port ?? ''}`
}

export function registerCookbooksHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const runtime = getCookbooksRuntime() ?? initializeCookbooksRuntime()

  // Push only on change: a new port invalidates every document the renderer
  // holds, so the surface refetches rather than reusing a dead origin.
  let lastKey = statusKey(runtime.getStatus())
  runtime.subscribe((status) => {
    const key = statusKey(status)
    if (key === lastKey) return
    lastKey = key
    pushTyped(server, RPC_CHANNELS.cookbooksLab.STATUS_CHANGED, { to: 'all' }, status)
  })

  server.handle(RPC_CHANNELS.cookbooksLab.ENSURE, () => runtime.ensure())
  server.handle(RPC_CHANNELS.cookbooksLab.STATUS, () => runtime.status())
  server.handle(RPC_CHANNELS.cookbooksLab.RESTART, () => runtime.restart())

  server.handle(RPC_CHANNELS.cookbooksLab.CATALOG, () => runtime.apiCatalog())
  server.handle(
    RPC_CHANNELS.cookbooksLab.OPEN,
    (_ctx, input: { itemId: string; newCopy?: boolean }) => runtime.apiOpen(input.itemId, input.newCopy === true),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.DOCUMENT,
    (_ctx, input: { itemId: string }) => runtime.apiDocument(input.itemId),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.RUN,
    (_ctx, input: { itemId: string; code: string; index: number }) =>
      runtime.apiRun(input.itemId, input.code, input.index),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.RUN_ALL,
    (_ctx, input: { itemId: string; cells: { index: number; source: string }[] }) =>
      runtime.apiRunAll(input.itemId, input.cells),
  )
  // Wave 15: the fast invoke answers `{runId}` as soon as the sidecar accepts
  // the run; every frame of the stream is pushed on RUN_EVENT verbatim (main
  // adds `runId` + a monotonic `seq` inside the runtime). No dedup: a live
  // stream is ordered and the surface needs every fragment.
  const pushRunEvent = (event: CookbooksRunStreamEvent): void => {
    pushTyped(server, RPC_CHANNELS.cookbooksLab.RUN_EVENT, { to: 'all' }, event)
  }
  server.handle(
    RPC_CHANNELS.cookbooksLab.RUN_STREAM,
    (_ctx, input: CookbooksRunStreamInput) => runtime.apiRunStream(input, pushRunEvent),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.RUN_ALL_STREAM,
    (_ctx, input: CookbooksRunAllStreamInput) => runtime.apiRunAllStream(input, pushRunEvent),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.SAVE,
    (_ctx, input: { itemId: string; index?: number; source?: string; text?: string }) => runtime.apiSave(input),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.RESET,
    (_ctx, input: { itemId: string }) => runtime.apiReset(input.itemId),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.CANCEL,
    (_ctx, input: { itemId: string }) => runtime.apiCancel(input.itemId),
  )
  server.handle(
    RPC_CHANNELS.cookbooksLab.EXPORT,
    (_ctx, input: { itemId: string; filename: string; content: string }) => runtime.exportNotebook(input),
  )
  // Wave 10: one handler for the four structural cell ops.
  server.handle(
    RPC_CHANNELS.cookbooksLab.MUTATE,
    (_ctx, input: CookbooksMutateInput) => runtime.apiMutate(input),
  )
}
