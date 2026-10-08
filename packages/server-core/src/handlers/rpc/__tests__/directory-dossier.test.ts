/**
 * W1-04 (#1501) — `directory:exportDossier` IPC: inert while the flag is
 * off, local-only, workspace-checked, verified write when on.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { isLocalOnly } from '@rox/shared/protocol/routing'
import { createLocalAcl } from '@rox/core/acl'
import type { HandlerFn, RequestContext, RpcHandlerOptions, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { registerDirectoryHandlers, type DirectoryHandlerRuntime } from '../directory.ts'

const roots: string[] = []
let previous: string | undefined
beforeEach(() => {
  previous = process.env.CRAFT_FEATURE_DOSSIER_EXPORT
  delete process.env.CRAFT_FEATURE_DOSSIER_EXPORT
})
afterEach(() => {
  if (previous === undefined) delete process.env.CRAFT_FEATURE_DOSSIER_EXPORT
  else process.env.CRAFT_FEATURE_DOSSIER_EXPORT = previous
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(runtime: Partial<DirectoryHandlerRuntime> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rox-dossier-rpc-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const options = new Map<string, RpcHandlerOptions | undefined>()
  const server = {
    handle(channel: string, handler: HandlerFn, o?: RpcHandlerOptions) { handlers.set(channel, handler); options.set(channel, o) },
    push() {},
  } as unknown as RpcServer
  registerDirectoryHandlers(server, {} as HandlerDeps, { workspaceFor: id => (id === 'ws' ? { id, rootPath: root } : null), enabledWorkbenchFlags: new Set(), ...runtime })
  const ctx: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: 1 }
  const call = (input: unknown, workspaceId = 'ws', context = ctx) => Promise.resolve(handlers.get(RPC_CHANNELS.directory.EXPORT_DOSSIER)!(context, workspaceId, input))
  return { root, call, options }
}

const payload = { schemaVersion: 1, data: { entities: [{ id: 'e1', name: 'Анна', kind: 'person', aliases: [], notes: '', promises: [] }] } }

describe('directory:exportDossier', () => {
  it('is inert while the flag is off (no store, no write)', async () => {
    const f = fixture()
    expect(await f.call(payload)).toEqual({ ok: false, reason: 'disabled' })
    expect(existsSync(join(f.root, '.rox'))).toBe(false)
  })

  it('is local-only', () => {
    const f = fixture()
    expect(f.options.get(RPC_CHANNELS.directory.EXPORT_DOSSIER)).toEqual({ access: 'localElectron' })
    expect(isLocalOnly(RPC_CHANNELS.directory.EXPORT_DOSSIER)).toBe(true)
  })

  it('imports with a verified write when the workbench flag is on', async () => {
    const f = fixture({ enabledWorkbenchFlags: () => new Set(['contacts.dossier-export.v1']) })
    expect(await f.call(payload)).toMatchObject({ ok: true, total: 1, created: 1, verified: true })
    expect(existsSync(join(f.root, '.rox', 'contacts', 'cards.json'))).toBe(true)
  })

  it('honours the env override', async () => {
    process.env.CRAFT_FEATURE_DOSSIER_EXPORT = '1'
    expect(await fixture().call(payload)).toMatchObject({ ok: true, verified: true })
    process.env.CRAFT_FEATURE_DOSSIER_EXPORT = '0'
    expect(await fixture({ enabledWorkbenchFlags: new Set(['contacts.dossier-export.v1']) }).call(payload)).toEqual({ ok: false, reason: 'disabled' })
  })

  it('negatives: unknown workspace, mismatched remote principal, non-owner, bad payload', async () => {
    process.env.CRAFT_FEATURE_DOSSIER_EXPORT = '1'
    const f = fixture()
    await expect(f.call(payload, 'nope')).rejects.toThrow('Workspace not found')
    const remote = { clientId: 'r', workspaceId: 'other', webContentsId: null, principal: { credentialId: 'x' } } as unknown as RequestContext
    await expect(f.call(payload, 'ws', remote)).rejects.toThrow('Directory workspace access denied')
    const restricted = fixture({ acl: createLocalAcl({ ownerPrincipalIds: ['someone-else'] }) })
    await expect(restricted.call(payload)).rejects.toThrow('Directory access denied')
    await expect(f.call({ schemaVersion: 9, data: { entities: [] } })).rejects.toThrow('UNSUPPORTED_VERSION')
  })
})
