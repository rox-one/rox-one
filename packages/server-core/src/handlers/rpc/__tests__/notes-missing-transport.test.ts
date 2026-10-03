import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { registerNotesHandlers } = await import('../notes')
const { registerContentHandlers } = await import('../content')
const { WsRpcServer } = await import('../../../transport/server')
const { WsRpcClient } = await import('../../../transport/client')
const { buildClientApi } = await import('../../../../../../apps/electron/src/transport/build-api')
const { capabilityErrorCode } = await import('../../../../../../apps/electron/src/renderer/lib/scoped-capability-read')

test('review source/path cases preserve error classification through RPC and the preload API', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rox-note-read-transport-')))
  const handlers = new Map<string, Function>()
  let allowed = true, pullError: Error | undefined
  registerNotesHandlers({ handle: (channel: string, handler: Function) => handlers.set(channel, handler), push: () => {} } as any, { nativeData: {
    authority: { hasRegisteredWorkspaces: () => true, authorize: () => allowed, permissionFence: () => allowed ? 'fence' : null, resolveWorkspace: () => ({ nativeRoot: root }) },
    sync: { pull: () => { if (pullError) throw pullError; return { entities: [], hasMore: false, nextSequence: 1 } } },
  } } as any)
  const context = { workspaceId: 'qa', principal: { issuer: 'fixture', subject: 'user' } }
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false, serverId: 'notes-read-acceptance' })
  server.handle('qa:read', () => handlers.get('notes:read')!(context, 'qa', 'folder/deleted'))
  await server.listen()
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { autoReconnect: false, requestTimeout: 3000 })
  try {
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture handshake timeout')), 5000)
      const off = client.onConnectionStateChanged(state => {
        if (state.status === 'connected') { clearTimeout(timer); off(); resolve() }
        else if (state.status === 'failed') { clearTimeout(timer); off(); reject(new Error('fixture handshake failed')) }
      })
    })
    client.connect(); await ready
    const api = buildClientApi(client, { readNote: { type: 'invoke', channel: 'qa:read' } })
    const expectedCodes = { 'root-missing': 'HANDLER_ERROR', 'root-file': 'DOCUMENT_AUTHORITY_CHANGED', 'parent-file': 'DOCUMENT_AUTHORITY_CHANGED',
      'healthy-source': 'NOT_FOUND', 'unrelated-ENOENT': 'HANDLER_ERROR', 'unrelated-EACCES': 'HANDLER_ERROR', 'unrelated-EIO': 'HANDLER_ERROR', 'unauthorized': 'HANDLER_ERROR' }
    const errnos: Record<string, string> = { 'unrelated-ENOENT': 'ENOENT', 'unrelated-EACCES': 'EACCES', 'unrelated-EIO': 'EIO' }
    for (const scenario of Object.keys(expectedCodes)) {
      await rm(join(root, 'notes'), { recursive: true, force: true })
      if (scenario === 'root-file') await writeFile(join(root, 'notes'), 'corrupt source')
      if (scenario !== 'root-file' && scenario !== 'root-missing') await mkdir(join(root, 'notes'))
      if (scenario === 'parent-file') await writeFile(join(root, 'notes', 'folder'), 'corrupt folder')
      allowed = scenario !== 'unauthorized'
      pullError = errnos[scenario] ? Object.assign(new Error('journal dependency failed'), { code: errnos[scenario], path: join(root, 'journal.db') }) : undefined
      let caught: any
      try { await api.readNote('qa', 'folder/deleted') } catch (error) { caught = error }
      expect(caught.code).toBe(expectedCodes[scenario as keyof typeof expectedCodes])
      expect(caught instanceof Error).toBe(false)
      expect(capabilityErrorCode(caught) === 'NOT_FOUND').toBe(scenario === 'healthy-source')
    }
    allowed = true; pullError = undefined
    await rm(join(root, 'notes'), { recursive: true, force: true }); await mkdir(join(root, 'notes'))
    for (const dangling of [false, true]) {
      const outside = join(root, 'outside')
      await mkdir(outside)
      await symlink(outside, join(root, 'notes', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
      if (dangling) await rm(outside, { recursive: true })
      const legacy = registerContentHandlers({ handle: () => {} } as any, {
        notesRoot: () => join(root, 'notes'), ownsWindow: () => true, changed: () => {},
        readNote: async () => { throw new Error('must not read forbidden content') },
      })
      await expect(handlers.get('notes:read')!(context, 'qa', 'escape/missing')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
      await expect(legacy.readNote({ workspaceId: 'qa', clientId: 'fixture', webContentsId: 1 } as any, 'qa', 'escape/missing')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
      await rm(join(root, 'notes', 'escape'), { recursive: true }); await rm(outside, { recursive: true, force: true })
    }
  } finally { client.destroy(); await server.close(); await rm(root, { recursive: true, force: true }) }
})

test('absence cannot outrank native revocation or legacy binding loss during validation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rox-note-read-fences-')))
  try {
    const notesRoot = join(root, 'notes')
    await mkdir(notesRoot)
    let allowed = true
    const handlers = new Map<string, Function>()
    registerNotesHandlers({ handle: (name: string, handler: Function) => handlers.set(name, handler), push: () => {} } as any, {
      nativeData: {
        authority: { hasRegisteredWorkspaces: () => true, authorize: () => allowed,
          permissionFence: () => allowed ? 'fence' : null, resolveWorkspace: () => ({ nativeRoot: root }) },
        sync: { pull: () => {
          queueMicrotask(() => { allowed = false })
          return { entities: [], hasMore: false, nextSequence: 1 }
        } },
      },
    } as any)
    let caught: any
    try { await handlers.get('notes:read')!({ workspaceId: 'qa', principal: { issuer: 'fixture', subject: 'user' } }, 'qa', 'missing') }
    catch (error) { caught = error }
    expect(caught).toBeDefined()
    expect(caught.code).not.toBe('NOT_FOUND')
    expect(caught.message).toContain('permission changed')
    for (const scenario of ['window-loss', 'root-binding-loss']) {
      let scopeChecks = 0, currentRoot = notesRoot
      const content = registerContentHandlers({ handle: () => {} } as any, {
        notesRoot: () => currentRoot,
        ownsWindow: () => {
          scopeChecks++
          if (scenario === 'root-binding-loss' && scopeChecks === 4) currentRoot = join(root, 'rebound')
          return scenario !== 'window-loss' || scopeChecks < 5
        },
        changed: () => {}, readNote: async () => { throw new Error('unexpected document read') },
      })
      caught = undefined
      try { await content.readNote({ workspaceId: 'qa', clientId: 'fixture', webContentsId: 1 } as any, 'qa', 'missing') }
      catch (error) { caught = error }
      expect(caught?.code).toBe(scenario === 'window-loss' ? 'AUTH_FAILED' : 'DOCUMENT_AUTHORITY_CHANGED')
    }
    const stable = registerContentHandlers({ handle: () => {} } as any, {
      notesRoot: () => notesRoot, ownsWindow: () => true, changed: () => {},
      readNote: async () => { throw new Error('unexpected document read') },
    })
    const context = { workspaceId: 'qa', clientId: 'fixture', webContentsId: 1 } as any
    await expect(stable.readNote(context, 'qa', 'folder/missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(stable.readNote(context, 'other', 'folder/missing')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
