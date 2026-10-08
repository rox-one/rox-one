import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { ENTITIES_LINKS_WORKBENCH_FLAG } from '@rox/shared/feature-flags'
import type { EntityRef } from '@rox/core/entities'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { closeEntityLinkStores } from '../../../entities/link-store.ts'
import { registerEntitiesHandlers, resetEntityResolvers, type EntitiesHandlerRuntime } from '../entities.ts'

const roots: string[] = []
let previousFlag: string | undefined

beforeEach(() => {
  previousFlag = process.env.CRAFT_FEATURE_ENTITIES_LINKS
  delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
})

afterEach(() => {
  closeEntityLinkStores()
  resetEntityResolvers()
  if (previousFlag === undefined) delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
  else process.env.CRAFT_FEATURE_ENTITIES_LINKS = previousFlag
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(runtime: EntitiesHandlerRuntime = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rox-entity-flag-'))
  roots.push(root)
  const handlers = new Map<string, HandlerFn>()
  const pushes: unknown[] = []
  const server = {
    handle(channel: string, handler: HandlerFn) {
      handlers.set(channel, handler)
    },
    push(channel: string, target: unknown, ...args: unknown[]) {
      pushes.push({ channel, target, args })
    },
  } as unknown as RpcServer
  registerEntitiesHandlers(server, {} as HandlerDeps, {
    workspaceFor: id => (id === 'ws' ? { id, rootPath: root } : null),
    ...runtime,
  })
  const ctx: RequestContext = { clientId: 'test', workspaceId: 'ws', webContentsId: null }
  const links = (payload: unknown) => Promise.resolve(handlers.get(RPC_CHANNELS.entities.LINKS)!(ctx, 'ws', payload))
  return { links }
}

const note: EntityRef = { kind: 'note', id: 'n1' }
const task: EntityRef = { kind: 'task', id: 't1' }

describe('entities handlers: workbench flag gating', () => {
  it('stays inert with no env and no workbench flags', async () => {
    const f = fixture()
    expect(await f.links({ op: 'add', from: note, to: task, relation: 'mentions' })).toEqual({
      ok: false,
      reason: 'disabled',
    })
  })

  it('the user-toggleable workbench flag enables the handlers', async () => {
    const f = fixture({ enabledWorkbenchFlags: new Set([ENTITIES_LINKS_WORKBENCH_FLAG]) })
    const added = (await f.links({ op: 'add', from: note, to: task, relation: 'mentions' })) as { ok: boolean }
    expect(added.ok).toBe(true)
  })

  it('env override off wins over the workbench flag', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '0'
    const f = fixture({ enabledWorkbenchFlags: new Set([ENTITIES_LINKS_WORKBENCH_FLAG]) })
    expect(await f.links({ op: 'add', from: note, to: task, relation: 'mentions' })).toEqual({
      ok: false,
      reason: 'disabled',
    })
  })

  it('env override on enables without the workbench flag', async () => {
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    const f = fixture()
    const added = (await f.links({ op: 'add', from: note, to: task, relation: 'mentions' })) as { ok: boolean }
    expect(added.ok).toBe(true)
  })
})
