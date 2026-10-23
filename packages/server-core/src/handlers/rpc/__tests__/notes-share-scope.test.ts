import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { registerNotesHandlers } = await import('../notes')

function register(root: string, allowed: () => boolean) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  registerNotesHandlers({ handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler), push: () => {} } as never, { nativeData: {
    authority: { hasRegisteredWorkspaces: () => true, authorize: allowed, permissionFence: () => allowed() ? 'fence' : null, resolveWorkspace: () => ({ nativeRoot: root }) },
    sync: { pull: () => ({ entities: [], hasMore: false, nextSequence: 1 }) },
  } } as never)
  return handlers
}

test('share handlers enforce workspace scope', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rox-share-scope-')))
  try {
    const handlers = register(root, () => true)
    const foreign = { workspaceId: 'other', principal: { issuer: 'fixture', subject: 'user' } }
    const unauthenticated = { workspaceId: 'qa', clientId: null, webContentsId: null }
    for (const ctx of [foreign, unauthenticated]) {
      await expect(Promise.resolve().then(() => handlers.get('notes:getShare')!(ctx, 'qa', 'Daily'))).rejects.toThrow()
      await expect(Promise.resolve().then(() => handlers.get('notes:updateShare')!(ctx, 'qa', 'Daily', { enabled: true }))).rejects.toThrow()
      await expect(Promise.resolve().then(() => handlers.get('notes:resolveShareLink')!(ctx, 'qa', 'Daily', 'aaaaaaaaaaaaaaaaaaaaaaaa'))).rejects.toThrow()
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('updateShare requires write authorization for native principals', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rox-share-scope-w-')))
  try {
    const handlers = register(root, () => false)
    const ctx = { workspaceId: 'qa', principal: { issuer: 'fixture', subject: 'user' } }
    await expect(Promise.resolve().then(() => handlers.get('notes:updateShare')!(ctx, 'qa', 'Daily', { enabled: true }))).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
