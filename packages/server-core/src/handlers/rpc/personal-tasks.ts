import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { resolveConfigDir } from '@craft-agent/shared/config/paths'
import {
  FileTaskRepository,
  LEGACY_RENDERER_KEY,
  PersonalTaskStore,
  TaskCorruptError,
  TaskQuotaError,
  TaskRevisionConflict,
  personalTasksPath,
} from '@craft-agent/core/tasks/personal'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.personalTasks.LOAD,
  RPC_CHANNELS.personalTasks.SAVE,
] as const

let repo: FileTaskRepository | null = null

function repository(): FileTaskRepository {
  repo ??= new FileTaskRepository(personalTasksPath(resolveConfigDir()))
  return repo
}

export function resetPersonalTasksRepositoryForTests(filePath?: string): void {
  repo = filePath ? new FileTaskRepository(filePath) : null
}

/** Canonical personal-task writer for meeting native actions (issue #367). */
export function personalTasksRepository(): FileTaskRepository {
  return repository()
}

export type PersonalTaskLoadDto = {
  json: string
  revision: number
  sha256: string
  backupPath?: string
  scope: 'personal'
  legacyKey: typeof LEGACY_RENDERER_KEY
}

export type PersonalTaskSaveDto = {
  json: string
  revision: number
  sha256: string
  scope: 'personal'
}

export function registerPersonalTasksHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.personalTasks.LOAD, async (_ctx, legacyJson?: string | null) => {
    try {
      if (typeof legacyJson === 'string' && legacyJson.trim()) {
        const migrated = await repository().migrateLegacyJson(legacyJson)
        return {
          json: migrated.store.exportJson(),
          revision: migrated.revision,
          sha256: migrated.sha256,
          backupPath: migrated.backupPath,
          scope: 'personal' as const,
          legacyKey: LEGACY_RENDERER_KEY,
        } satisfies PersonalTaskLoadDto
      }
      const loaded = await repository().load()
      return {
        json: loaded.store.exportJson(),
        revision: loaded.revision,
        sha256: loaded.sha256,
        backupPath: loaded.backupPath,
        scope: 'personal' as const,
        legacyKey: LEGACY_RENDERER_KEY,
      } satisfies PersonalTaskLoadDto
    } catch (error) {
      if (error instanceof TaskCorruptError) {
        return {
          json: new PersonalTaskStore().exportJson(),
          revision: 0,
          sha256: '',
          backupPath: error.backupPath,
          scope: 'personal' as const,
          legacyKey: LEGACY_RENDERER_KEY,
        } satisfies PersonalTaskLoadDto
      }
      throw error
    }
  })

  server.handle(RPC_CHANNELS.personalTasks.SAVE, async (_ctx, input: { json: string; expectedRevision: number }) => {
    try {
      const store = PersonalTaskStore.fromJson(input.json)
      const saved = await repository().save(store, input.expectedRevision)
      return {
        json: saved.json,
        revision: saved.revision,
        sha256: saved.sha256,
        scope: 'personal' as const,
      } satisfies PersonalTaskSaveDto
    } catch (error) {
      if (error instanceof TaskRevisionConflict || error instanceof TaskQuotaError) {
        throw new Error(error.name)
      }
      throw error
    }
  })
}
