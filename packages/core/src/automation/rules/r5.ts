/**
 * W1-12 (#1509) — R5: new account → personal Drive (1 TiB default)
 * (DATA-MODEL §5.16, TECH-SPEC §16.3; D-v2-8: 1 TiB per user, admin-adjustable).
 *
 * Fires on `identity.account_created`. In local mode the same rule provisions
 * the local drive (`~/rox/drive/` per ADR-U13); its handlers are the local
 * authority's.
 */

import type { EntityRef } from '../../entities/refs.ts'
import type { DomainEvent } from '../../events/types.ts'
import { accountCreatedOf } from '../events.ts'
import { uuidv5 } from '../ids.ts'
import type { DomainRule, RuleStep } from '../rule.ts'

/** D-v2-8 default quota: 1 TiB (`"1 TB"` in the UI). */
export const DEFAULT_DRIVE_QUOTA_BYTES = 1024 ** 4

export interface R5Params {
  quotaBytes: number
  /** Virtual folder names registered on provisioning (artifacts, chat files, recordings). */
  folders: string[]
}

export const R5_DEFAULT_PARAMS: R5Params = {
  quotaBytes: DEFAULT_DRIVE_QUOTA_BYTES,
  folders: ['Артефакты', 'Файлы чатов', 'Записи'],
}

export function readR5Params(params: Readonly<Record<string, unknown>> = {}): R5Params {
  const folders = params.folders
  const quota = params.quotaBytes
  return {
    quotaBytes: typeof quota === 'number' && Number.isFinite(quota) && quota > 0 ? Math.floor(quota) : R5_DEFAULT_PARAMS.quotaBytes,
    folders: Array.isArray(folders) && folders.every(entry => typeof entry === 'string') ? (folders as string[]) : R5_DEFAULT_PARAMS.folders,
  }
}

export function r5Key(principalId: string): string {
  return `R5:${principalId}`
}

/** Deterministic id of a virtual drive folder (stable across replays). */
export function virtualFolderId(principalId: string, name: string): string {
  return uuidv5(`drive-folder:${principalId}:${name}`)
}

export const R5: DomainRule = {
  id: 'R5',
  triggers: ['identity.account_created'],
  scope: 'workspace',

  async targets(_ctx, event) {
    const payload = accountCreatedOf(event)
    return payload ? [{ subject: payload.principalId }] : []
  },

  async enabled(ctx) {
    return (await ctx.settings('R5')).enabled
  },

  async conditions(_ctx, event) {
    return accountCreatedOf(event) ? null : 'unknown_event'
  },

  key(ctx) {
    return r5Key(ctx.subject)
  },

  async steps(ctx) {
    const member = ctx.subject
    const params = readR5Params(await ctx.params('R5'))
    const memberRef: EntityRef = { kind: 'person', id: member }
    const rootRef: EntityRef = { kind: 'folder', id: uuidv5(`drive-root:${member}`) }

    const steps: RuleStep[] = [
      {
        name: 'provision-drive',
        actor: 'system',
        command: {
          type: 'drive.provision',
          payload: { quotaBytes: params.quotaBytes },
          target: memberRef,
        },
      },
    ]
    for (const name of params.folders) {
      steps.push({
        name: `folder:${name}`,
        actor: 'system',
        // Registration of the virtual folders is best-effort: the drive itself is the contract.
        optional: true,
        command: {
          type: 'drive.create_folder',
          payload: { id: virtualFolderId(member, name), name, ownerType: 'user', ownerId: member },
          target: rootRef,
        },
      })
    }
    return steps
  },
} satisfies DomainRule<DomainEvent>