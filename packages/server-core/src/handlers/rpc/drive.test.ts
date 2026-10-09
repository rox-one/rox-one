import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { DriveUploadTarget, ImportProvider, ImportSourceEntry } from '@rox/shared/drive'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import {
  configureDriveImport,
  resetDriveImport,
  registerDriveHandlers,
  HANDLED_CHANNELS,
} from './drive'

class StubProvider implements ImportProvider {
  readonly id = 'google-drive' as const

  async list(folderId?: string): Promise<ImportSourceEntry[]> {
    // `folderId` is the entry's `id` (the walker recurses on ids), so the
    // child listing is keyed on `dir` — the folder's name is only used for paths.
    if (folderId === 'dir') return [{ id: 'b', name: 'b.txt', kind: 'file', sizeBytes: 4 }]
    return [
      { id: 'a', name: 'a.txt', kind: 'file', sizeBytes: 3 },
      { id: 'dir', name: 'sub', kind: 'folder' },
    ]
  }

  async stream(sourceId: string): Promise<ReadableStream<Uint8Array>> {
    const bytes = new Uint8Array(sourceId === 'a' ? [1, 1, 1] : [2, 2, 2, 2])
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
  }
}

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability() { return false },
    findClientsWithCapability() { return [] }, isRequestContextCurrent() { return true },
  } as unknown as RpcServer
  registerDriveHandlers(server, { platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } } } as unknown as HandlerDeps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`channel not registered: ${channel}`)
    return handler(context, ...args)
  }
  return { handlers, invoke }
}

const context: RequestContext = { clientId: 'client', workspaceId: 'workspace', webContentsId: null }

describe('drive import RPC handlers', () => {
  let stateDir: string
  let provider: StubProvider
  let puts: string[]

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'rox-drive-import-rpc-'))
    provider = new StubProvider()
    puts = []
    const target: DriveUploadTarget = {
      async put(key, body) {
        await (body instanceof Uint8Array ? Promise.resolve() : new Response(body).arrayBuffer())
        puts.push(key)
      },
    }
    configureDriveImport({ stateDir, target, providers: [provider], concurrency: 1, sleep: async () => {} })
  })

  afterEach(async () => {
    resetDriveImport()
    await rm(stateDir, { recursive: true, force: true })
  })

  test('registers every HANDLED_CHANNELS entry', () => {
    const { handlers } = harness()
    for (const channel of HANDLED_CHANNELS) expect(handlers.has(channel)).toBe(true)
    expect(handlers.size).toBe(HANDLED_CHANNELS.length)
  })

  test('plans, starts and reports a job', async () => {
    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string; status: string; plan: unknown[] }
    expect(job.status).toBe('idle')
    expect(job.plan).toHaveLength(2)

    const started = await invoke(RPC_CHANNELS.drive.IMPORT_START, job.id) as { status: string }
    expect(started.status).toBe('done')
    expect(puts).toEqual([`${job.id}/a.txt`, `${job.id}/sub/b.txt`])

    const status = await invoke(RPC_CHANNELS.drive.IMPORT_STATUS, job.id) as { status: string }
    expect(status.status).toBe('done')
  })

  test('pause and resume round-trip through the RPC surface', async () => {
    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string }
    await invoke(RPC_CHANNELS.drive.IMPORT_START, job.id)
    await invoke(RPC_CHANNELS.drive.IMPORT_PAUSE, job.id)
    const resumed = await invoke(RPC_CHANNELS.drive.IMPORT_RESUME, job.id) as { status: string }
    expect(resumed.status).toBe('done')
  })

  test('status without an id lists known jobs', async () => {
    const { invoke } = harness()
    const job = await invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive') as { id: string }
    const list = await invoke(RPC_CHANNELS.drive.IMPORT_STATUS) as Array<{ id: string }>
    expect(list.map(entry => entry.id)).toEqual([job.id])
  })

  test('rejects an unknown provider id', async () => {
    const { invoke } = harness()
    await expect(invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'dropbox')).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  test('answers UNSUPPORTED_OPERATION when the host did not compose imports', async () => {
    resetDriveImport()
    const { invoke } = harness()
    await expect(invoke(RPC_CHANNELS.drive.IMPORT_PLAN, 'google-drive')).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })
})