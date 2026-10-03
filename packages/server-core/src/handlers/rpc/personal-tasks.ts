/**
 * personalTasks:* RPC — Things-style personal tasks persisted per task file
 * under the local config dir ({configDir}/personal-tasks/). LOCAL_ONLY:
 * the renderer's localStorage (the migration source) is local too.
 */
import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { resolveConfigDir } from '@craft-agent/shared/config'
import type { PersonalTaskDelete, PersonalTaskWrite } from '@craft-agent/core/tasks/personal'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { PersonalTaskPersistStore, type PersonalTaskMeta } from '../../tasks/personal-persist.ts'
import {
  deletePersonalTasks,
  migratePersonalTasks,
  putPersonalTasks,
  readPersonalTasks,
  type PersonalTasksMigrateInput,
} from '../../tasks/personal-tasks-service.ts'
import type { RequestContext } from '../../transport/types'
import { NativePersonalTasksStore, type NativePersonalTaskScope } from './native-personal-tasks'
import { readNativeWorkspaceRegistry } from './native-workspace-registry'
import { awardNativeXpAndBroadcast } from './gamification'

export const PERSONAL_TASKS_HANDLED_CHANNELS = [
  RPC_CHANNELS.personalTasks.LIST,
  RPC_CHANNELS.personalTasks.PUT,
  RPC_CHANNELS.personalTasks.DELETE,
  RPC_CHANNELS.personalTasks.MIGRATE,
] as const

let cached: { root: string; store: PersonalTaskPersistStore } | null = null

export function personalTasksStore(rootDir: string = resolveConfigDir()): PersonalTaskPersistStore {
  if (!cached || cached.root !== rootDir) cached = { root: rootDir, store: new PersonalTaskPersistStore(rootDir) }
  return cached.store
}

export function resetPersonalTasksStoreForTests(): void {
  cached = null
}

export function registerPersonalTasksHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  let nativeStore: NativePersonalTasksStore | null = null
  const readers = new Map<string, { context: RequestContext; scope: NativePersonalTaskScope }>()
  server.onClientDisconnect?.(clientId => readers.delete(clientId))
  server.onShutdown?.(() => readers.clear())
  const nativeScope = (ctx: RequestContext, action: 'read' | 'write'): { scope: NativePersonalTaskScope; assertCurrent: () => void; store: NativePersonalTasksStore } => {
    if (!ctx.principal || !ctx.workspaceId || !deps.nativeData) throw new CodedError('FORBIDDEN', 'Personal task authority unavailable')
    const workspace = readNativeWorkspaceRegistry(ctx.workspaceId)
    if (!workspace) throw new CodedError('FORBIDDEN', 'Personal task workspace unavailable')
    const scope: NativePersonalTaskScope = { principal: ctx.principal, workspaceId: ctx.workspaceId, rootPath: workspace.rootPath }
    const assertCurrent = () => {
      if (server.isRequestContextCurrent?.(ctx, action) !== true
        || readNativeWorkspaceRegistry(scope.workspaceId)?.rootPath !== scope.rootPath
        || !deps.nativeData!.authority.authorize(scope.principal, scope.workspaceId, action, scope.rootPath)) throw new CodedError('FORBIDDEN', 'Personal task permission changed')
    }
    assertCurrent()
    nativeStore ??= new NativePersonalTasksStore(deps.nativeData.authority.stateDirectory)
    readers.set(ctx.clientId, { context: ctx, scope })
    return { scope, assertCurrent, store: nativeStore }
  }
  const nativeChanged = (own: NativePersonalTaskScope) => {
    for (const [clientId, reader] of readers) {
      const { scope, context } = reader
      if (scope.principal.issuer !== own.principal.issuer || scope.principal.subject !== own.principal.subject
        || scope.workspaceId !== own.workspaceId || scope.rootPath !== own.rootPath) continue
      if (server.isRequestContextCurrent?.(context, 'read') !== true
        || readNativeWorkspaceRegistry(scope.workspaceId)?.rootPath !== scope.rootPath
        || !deps.nativeData?.authority.authorize(scope.principal, scope.workspaceId, 'subscribe', scope.rootPath)) { readers.delete(clientId); continue }
      pushTyped(server, RPC_CHANNELS.personalTasks.CHANGED, { to: 'client', clientId }, { at: Date.now() })
    }
  }
  const changed = (exclude?: string) =>
    pushTyped(server, RPC_CHANNELS.personalTasks.CHANGED, { to: 'all', exclude }, { at: Date.now() })

  server.handle(RPC_CHANNELS.personalTasks.LIST, async (ctx) => {
    if (!ctx.principal) return readPersonalTasks(personalTasksStore())
    const { store, scope, assertCurrent } = nativeScope(ctx, 'read')
    return store.read(scope, assertCurrent)
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(
    RPC_CHANNELS.personalTasks.PUT,
    async (ctx, writes: PersonalTaskWrite[], meta?: PersonalTaskMeta | null) => {
      if (ctx.principal) {
        const { store, scope, assertCurrent } = nativeScope(ctx, 'write')
        const result = store.put(scope, writes, meta, assertCurrent)
        if (result.accepted.length) awardNativeXpAndBroadcast(server, deps, ctx, 'first_task', `personal-task:${scope.workspaceId}:${result.accepted[0]!.task.id}`)
        if (result.accepted.length || meta != null) nativeChanged(scope)
        return result
      }
      const result = putPersonalTasks(personalTasksStore(), Array.isArray(writes) ? writes : [], meta ?? null)
      if (result.rejected.length) log.warn(`personalTasks:put rejected ids ${result.rejected.join(',')}`)
      if (result.accepted.length || meta != null) changed(ctx.clientId)
      return result
    },
    { access: 'nativeOrLocalElectron', nativeAction: 'write' },
  )

  server.handle(RPC_CHANNELS.personalTasks.DELETE, async (ctx, deletes: PersonalTaskDelete[]) => {
    if (ctx.principal) {
      const { store, scope, assertCurrent } = nativeScope(ctx, 'write')
      const result = store.delete(scope, deletes, assertCurrent)
      if (result.removed.length) nativeChanged(scope)
      return result
    }
    const result = deletePersonalTasks(personalTasksStore(), Array.isArray(deletes) ? deletes : [])
    if (result.rejected.length) log.warn(`personalTasks:delete rejected ids ${result.rejected.join(',')}`)
    if (result.removed.length) changed(ctx.clientId)
    return result
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.personalTasks.MIGRATE, async (ctx, input: PersonalTasksMigrateInput) => {
    if (ctx.principal) {
      const { store, scope, assertCurrent } = nativeScope(ctx, 'write')
      const result = store.migrate(scope, input, assertCurrent)
      if (result.status === 'migrated') nativeChanged(scope)
      return result
    }
    const result = migratePersonalTasks(personalTasksStore(), input ?? { bundle: null })
    if (result.status === 'migrated') {
      log.info(`personalTasks: migrated ${result.imported} task(s) from localStorage (skipped ${result.skipped})`)
      changed(ctx.clientId)
    }
    return result
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })
}
