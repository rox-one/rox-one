/**
 * W1-04 (#1501) — Directory RPC: MIG-06 Dossier export.
 *
 * `directory:exportDossier` receives the renderer's Dossier payload once,
 * imports it into the workspace-local contact store
 * (`<workspaceRoot>/.rox/contacts/cards.json`) and returns a verified-write
 * receipt. The renderer deletes its localStorage key only when
 * `verified === true` (wave-2 PPL owns that call site).
 *
 * Inert when off: gated by `isDossierExportEnabled()` — workbench flag
 * `contacts.dossier-export.v1` (default OFF) with the
 * `CRAFT_FEATURE_DOSSIER_EXPORT` env override. While off nothing is read or
 * written and the handler answers `{ ok: false, reason: 'disabled' }`.
 *
 * Local only: the store belongs to this host's single owner (local ACL shim),
 * so the channel is `localElectron` and LOCAL_ONLY in routing.
 */

import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { isDossierExportEnabled } from '@rox/shared/feature-flags'
import { createLocalAcl, type Acl } from '@rox/core/acl'
import type { RpcServer } from '@rox/server-core/transport'
import type { RequestContext } from '../../transport/types.ts'
import type { HandlerDeps } from '../handler-deps'
import { ContactCardStore, ContactCardStoreError } from '../../contacts/store.ts'
import { DossierImportError, importDossier, type DossierImportResult } from '../../contacts/dossier-import.ts'
import { getEntitiesWorkbenchFlags } from '../../entities/workbench-flags.ts'

export const HANDLED_CHANNELS = [RPC_CHANNELS.directory.EXPORT_DOSSIER] as const

export type ExportDossierResult =
  | ({ ok: true } & DossierImportResult)
  | { ok: false; reason: 'disabled' }

export interface DirectoryHandlerRuntime {
  workspaceFor?: (id: string) => { id: string; rootPath: string } | null
  /** Live enabled-workbench-flag source (defaults to the process-wide one). */
  enabledWorkbenchFlags?: ReadonlySet<string> | (() => ReadonlySet<string> | undefined)
  /** Local ACL (defaults to the single-user shim). */
  acl?: Acl
  now?: () => number
}

function enabledFlags(runtime: DirectoryHandlerRuntime): ReadonlySet<string> | undefined {
  if (typeof runtime.enabledWorkbenchFlags === 'function') return runtime.enabledWorkbenchFlags()
  return runtime.enabledWorkbenchFlags ?? getEntitiesWorkbenchFlags()
}

function principalId(ctx: RequestContext): string {
  return ctx.actor?.principalId ?? ctx.principal?.credentialId ?? 'local'
}

export function registerDirectoryHandlers(server: RpcServer, _deps: HandlerDeps, runtime: DirectoryHandlerRuntime = {}): void {
  const workspaceFor = runtime.workspaceFor ?? (getWorkspaceByNameOrId as (id: string) => { id: string; rootPath: string } | null)
  const acl = runtime.acl ?? createLocalAcl()

  server.handle(RPC_CHANNELS.directory.EXPORT_DOSSIER, async (ctx, workspaceId: string, input: unknown): Promise<ExportDossierResult> => {
    if (!isDossierExportEnabled(enabledFlags(runtime))) return { ok: false, reason: 'disabled' }
    if (typeof workspaceId !== 'string' || !workspaceId) throw new CodedError('INVALID_PAYLOAD', 'Workspace id is required')
    if (ctx.principal && workspaceId !== ctx.workspaceId) throw new CodedError('FORBIDDEN', 'Directory workspace access denied')
    const workspace = workspaceFor(workspaceId)
    if (!workspace) throw new CodedError('NOT_FOUND', 'Workspace not found')
    const owner = principalId(ctx)
    // Local authority: only the owner principal may write its contact store.
    const allowed = await acl.can({ id: owner, workspaceId: workspace.id }, 'edit', { kind: 'person', id: owner })
    if (!allowed) throw new CodedError('FORBIDDEN', 'Directory access denied')
    try {
      const result = importDossier(new ContactCardStore(workspace.rootPath), input, {
        workspaceId: workspace.id,
        ownerId: owner,
        ...(runtime.now ? { now: runtime.now } : {}),
      })
      return { ok: true, ...result }
    } catch (error) {
      if (error instanceof DossierImportError) throw new CodedError('INVALID_PAYLOAD', `Dossier export rejected: ${error.code}`)
      if (error instanceof ContactCardStoreError) throw new CodedError('CONFLICT', `Contact store unavailable: ${error.code}`)
      throw error
    }
  }, { access: 'localElectron' })
}
