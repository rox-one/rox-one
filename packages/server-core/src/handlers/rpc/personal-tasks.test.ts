import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn } from '@craft-agent/server-core/transport'
import { PersonalTaskStore, personalTasksPath } from '@craft-agent/core/tasks/personal'
import { registerPersonalTasksHandlers, HANDLED_CHANNELS, resetPersonalTasksRepositoryForTests } from './personal-tasks.ts'

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
  } as RpcServer
  registerPersonalTasksHandlers(server, {} as never)
  return {
    async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing ${channel}`)
      return handler({} as never, ...args) as Promise<T>
    },
  }
}

describe('personal tasks RPC', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'personal-tasks-rpc-'))
    resetPersonalTasksRepositoryForTests(personalTasksPath(dir))
  })

  afterEach(() => {
    resetPersonalTasksRepositoryForTests()
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers load/save and persists across restart', async () => {
    expect([...HANDLED_CHANNELS]).toEqual([RPC_CHANNELS.personalTasks.LOAD, RPC_CHANNELS.personalTasks.SAVE])
    const rpc = createHarness()
    const store = new PersonalTaskStore()
    store.create({ title: 'Desk', now: 1 })
    const saved = await rpc.invoke<{ json: string; revision: number }>(RPC_CHANNELS.personalTasks.SAVE, {
      json: store.exportJson(),
      expectedRevision: 0,
    })
    expect(saved.revision).toBe(1)
    resetPersonalTasksRepositoryForTests(personalTasksPath(dir))
    const loaded = await rpc.invoke<{ json: string; revision: number }>(RPC_CHANNELS.personalTasks.LOAD)
    expect(PersonalTaskStore.fromJson(loaded.json).list()[0]?.title).toBe('Desk')
    expect(loaded.revision).toBe(1)
  })

  it('preserves a corrupt file backup path', async () => {
    writeFileSync(personalTasksPath(dir), '{bad')
    const rpc = createHarness()
    const loaded = await rpc.invoke<{ backupPath?: string; json: string }>(RPC_CHANNELS.personalTasks.LOAD)
    expect(loaded.backupPath).toBeDefined()
    expect(PersonalTaskStore.fromJson(loaded.json).list()).toEqual([])
  })
})
