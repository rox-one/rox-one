/**
 * Main-process mirror of the renderer's `entities.links.v1` flag.
 *
 * The renderer owns the persisted atom (Settings toggle → localStorage) and
 * notifies main over IPC (`entities:setLinksEnabled`). Main applies the value
 * to both consumers that live in this process:
 * - the shared deep-link parser (`setEntityRoutesEnabled`), so `rox://docs/…`
 *   acceptance always agrees with the renderer;
 * - the server-core live workbench-flag source, so `entities:*` handlers
 *   enable without re-registering (`CRAFT_FEATURE_ENTITIES_LINKS` stays as
 *   the env override inside `isEntitiesLinksEnabled`).
 */

import type { IpcMain } from 'electron'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { setEntitiesWorkbenchFlags } from '@rox/server-core/entities/workbench-flags'
import { setEntityRoutesEnabled } from '../shared/route-parser'

export function applyEntitiesLinksFlag(enabled: boolean): void {
  setEntityRoutesEnabled(enabled)
  setEntitiesWorkbenchFlags(enabled ? [WORKBENCH_FLAG.entitiesLinksV1] : [])
}

export function registerEntitiesLinksIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle('entities:setLinksEnabled', async (_event, enabled: unknown) => {
    applyEntitiesLinksFlag(enabled === true)
    return { ok: true }
  })
}
