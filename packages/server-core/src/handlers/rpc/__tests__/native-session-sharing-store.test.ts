import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeSessionCollaboration, type NativeSharingScope } from '../native-session-collaboration'
import type { Session, SessionCommand } from '@craft-agent/shared/protocol'

const cleanups: Array<() => void> = []
afterEach(() => { for (const action of cleanups.splice(0).reverse()) action() })
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'native-share-store-')); cleanups.push(() => rmSync(path, { recursive: true, force: true })); return path }
const logger = { info() {}, warn() {}, error() {} }
const scope: NativeSharingScope = { issuer: 'issuer-a', subject: 'same-subject', workspaceId: 'workspace', workspaceRootPath: '/fixture/root', sessionId: 'session' }
const session = { id: 'session', workspaceId: 'workspace', workspaceName: 'Workspace', lastMessageAt: 1, isProcessing: false, messages: [] } as Session

test('same subject under another issuer cannot revoke or consume a native invitation', async () => {
  const store = new NativeSessionCollaboration(join(directory(), 'custody')); cleanups.push(() => store.close())
  const run = (actor: NativeSharingScope, command: SessionCommand) => store.command(actor, command, session, () => {}, logger)
  const card = await run(scope, { type: 'inviteBro', role: 'viewer' }) as { url: string }
  const joinKey = new URL(card.url).pathname.split('/').at(-1)!
  const foreign = { ...scope, issuer: 'issuer-b' }
  await expect(run(foreign, { type: 'revokeBroInvite', joinKey })).rejects.toThrow('Invitation owner denied')
  expect(await run(foreign, { type: 'joinBroInvite', url: card.url })).toEqual({ ok: false, error: 'invalid' })
  expect(await run({ ...scope, subject: 'bob' }, { type: 'joinBroInvite', url: card.url })).toMatchObject({ ok: true, workspaceId: scope.workspaceId, role: 'viewer' })
})

test('native share custody rejects symlinked directory and private capability database', () => {
  const root = directory(), foreign = directory()
  symlinkSync(foreign, join(root, 'custody'))
  expect(() => new NativeSessionCollaboration(join(root, 'custody'))).toThrow('custody directory')
  rmSync(join(root, 'custody')); mkdirSync(join(root, 'custody'))
  writeFileSync(join(foreign, 'database'), '')
  symlinkSync(join(foreign, 'database'), join(root, 'custody/native-share-links.sqlite'))
  expect(() => new NativeSessionCollaboration(join(root, 'custody'))).toThrow('private regular file')
})
