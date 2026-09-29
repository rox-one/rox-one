/**
 * personalTasks:* RPC — Things-style personal tasks persisted per task file
 * under the local config dir ({configDir}/personal-tasks/). LOCAL_ONLY:
 * the renderer's localStorage (the migration source) is local too.
 */
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { resolveConfigDir } from '@craft-agent/shared/config'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
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
  const changed = (exclude?: string) =>
    pushTyped(server, RPC_CHANNELS.personalTasks.CHANGED, { to: 'all', exclude }, { at: Date.now() })

  server.handle(RPC_CHANNELS.personalTasks.LIST, async () => readPersonalTasks(personalTasksStore()))

  server.handle(
    RPC_CHANNELS.personalTasks.PUT,
    async (ctx, tasks: PersonalTask[], meta?: PersonalTaskMeta | null) => {
      const result = putPersonalTasks(personalTasksStore(), Array.isArray(tasks) ? tasks : [], meta ?? null)
      if (result.rejected.length) log.warn(`personalTasks:put rejected ids ${result.rejected.join(',')}`)
      changed(ctx.clientId)
      return result
    },
  )

  server.handle(RPC_CHANNELS.personalTasks.DELETE, async (ctx, ids: string[]) => {
    const removed = deletePersonalTasks(personalTasksStore(), Array.isArray(ids) ? ids : [])
    changed(ctx.clientId)
    return { removed }
  })

  server.handle(RPC_CHANNELS.personalTasks.MIGRATE, async (ctx, input: PersonalTasksMigrateInput) => {
    const result = migratePersonalTasks(personalTasksStore(), input ?? { bundle: null })
    if (result.status === 'migrated') {
      log.info(`personalTasks: migrated ${result.imported} task(s) from localStorage (skipped ${result.skipped})`)
      changed(ctx.clientId)
    }
    return result
  })
}
