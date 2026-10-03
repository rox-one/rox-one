import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority.ts'
import { WsRpcServer } from '../../transport/server.ts'
import { PROTOCOL_VERSION, RPC_CHANNELS, type MessageEnvelope } from '@rox/shared/protocol'
import { emptyMeeting } from '@rox/core/meetings'
import { deserializeEnvelope } from '../../transport/codec.ts'
import { MeetingJournal } from '../../meetings/journal.ts'
import { nativeMeetingPlanner, registerMeetingPlanningHandlers } from './meeting-planning.ts'
import type { HandlerDeps } from '../handler-deps.ts'
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
async function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'meeting-native-plan-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const authority = new NativeAuthority({ stateDir: join(dir, 'state') })
  cleanups.push(() => authority.close())
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin: NativeIssuedCredential
  try { Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); admin = authority.bootstrapLocalAdministrator('operator') }
  finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
  const nativeRoot = join(dir, 'workspace'); mkdirSync(nativeRoot)
  const workspaceId = authority.registerWorkspace(admin.credential, 'ws', nativeRoot).id
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'device', Date.now() + 60000), 'device')!
  authority.grantWorkspace(admin.credential, issued.principal.subject, workspaceId, ['read'])
  const root = join(dir, 'config', 'meetings', workspaceId)
  const journal = new MeetingJournal(root)
  journal.commit({ workspaceId, meetingId: 'meeting-a', expectedRevision: 0, commandId: 'create-a',
    events: [{ type: 'meeting.created', meeting: emptyMeeting({ workspaceId, meetingId: 'meeting-a', title: 'Canonical', now: 1 }) }], outboxEntries: [] })
  journal.commit({ workspaceId: 'foreign', meetingId: 'meeting-foreign', expectedRevision: 0, commandId: 'create-foreign',
    events: [{ type: 'meeting.created', meeting: emptyMeeting({ workspaceId: 'foreign', meetingId: 'meeting-foreign', title: 'Secret', now: 1 }) }], outboxEntries: [] })
  journal.releaseWriter()
  const deps = { nativeData: { authority } } as unknown as HandlerDeps
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority, validateToken: async () => true })
  registerMeetingPlanningHandlers(server, deps, id => id === workspaceId ? root : null)
  cleanups.push(() => server.close()); await server.listen()
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
  cleanups.push(() => socket.terminate())
  const messages: MessageEnvelope[] = []; socket.on('message', data => messages.push(deserializeEnvelope(data.toString())))
  await once(socket, 'open')
  socket.send(JSON.stringify({ id: 'hello', type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId, token: issued.credential }))
  await wait(socket, messages, 'hello')
  const invoke = async (id: string, input: unknown) => {
    const requestId = crypto.randomUUID(); socket.send(JSON.stringify({ id: requestId, type: 'request', channel: RPC_CHANNELS.meetings.PLAN_ACTIONS, args: [id, input] }))
    return wait(socket, messages, requestId)
  }
  return { authority, admin, issued, deps, root, dir, workspaceId, journal, invoke }
}
function wait(socket: WebSocket, messages: MessageEnvelope[], id: string) {
  const existing = messages.find(m => m.id === id); if (existing) return Promise.resolve(existing)
  const { promise, resolve } = Promise.withResolvers<MessageEnvelope>()
  const listener = (data: WebSocket.RawData) => { const m = deserializeEnvelope(data.toString()); if (m.id === id) { socket.off('message', listener); resolve(m) } }
  socket.on('message', listener); return promise
}
test('actual authenticated native RPC binds slash/profile/followup to a canonical meeting without effects', async () => {
  const f = await fixture()
  const before = readFileSync(f.journal.journalPath('meeting-a'), 'utf8')
  const result = await f.invoke(f.workspaceId, { meetingId: 'meeting-a', recipeId: 'standup', slash: '/design-review', followup: {
    id: 'schedule-a', kind: 'send', timezone: 'UTC', expiresAt: Date.now() + 60000, budgetRemaining: 1, maxRetries: 3, missedRunPolicy: 'hold', scope: 'server' } })
  expect(result.error).toBeUndefined()
  expect(result.result).toMatchObject({ sourceRevision: 1, recipeId: 'design-review', outputSchemaId: 'meeting.design-review.v1',
    jobs: [{ roleId: 'rox.meeting.knowledge', status: 'planned' }, { roleId: 'rox.meeting.scribe', status: 'planned' }],
    execution: { allowed: false, verified: false }, followup: { policy: 'send-requires-fresh-grant', execution: { allowed: false, verified: false } } })
  expect(readFileSync(f.journal.journalPath('meeting-a'), 'utf8')).toBe(before)
  expect(existsSync(join(f.root, 'followup-ledger.json'))).toBe(false)
  expect(f.journal.read('meeting-a').outbox).toEqual([])
})
test('rejects foreign workspace, foreign meeting, traversal, unknown skill and forged privileges', async () => {
  const f = await fixture()
  for (const [workspace, input] of [
    ['foreign', { meetingId: 'meeting-a' }], [f.workspaceId, { meetingId: 'meeting-foreign' }],
    [f.workspaceId, { meetingId: '../../secret' }], [f.workspaceId, { meetingId: 'meeting-a', slash: '/shell' }],
    [f.workspaceId, { meetingId: 'meeting-a', override: { recipeId: 'standup', extraActions: ['crm.update'] } }],
  ] as Array<[string, unknown]>) expect((await f.invoke(workspace, input)).error).toBeDefined()
  expect(() => nativeMeetingPlanner(f.deps, { workspaceId: f.workspaceId }, f.workspaceId, f.root)).toThrow()
  expect(() => nativeMeetingPlanner(f.deps, { workspaceId: f.workspaceId, principal: { ...f.issued.principal } }, f.workspaceId, f.root)).toThrow()
})
test('captured and in-flight readers deny revoked verified credentials', async () => {
  const f = await fixture()
  const principal = f.authority.authenticate(f.issued.credential)!
  const planner = nativeMeetingPlanner(f.deps, { workspaceId: f.workspaceId, principal }, f.workspaceId, f.root)
  const pending = planner.plan({ meetingId: 'meeting-a' })
  f.authority.revokeWorkspaceGrant(f.admin.credential, principal.subject, f.workspaceId)
  await expect(pending).rejects.toThrow('permission changed')
  await expect(planner.plan({ meetingId: 'meeting-a' })).rejects.toThrow('permission changed')
})
test('read-only canonical reader refuses repair and all writes, preserving corrupt source bytes', async () => {
  const f = await fixture()
  const path = f.journal.journalPath('meeting-a'); appendFileSync(path, '{corrupt-tail\n')
  const before = readFileSync(path, 'utf8')
  const reader = new MeetingJournal(f.root, { readOnly: true })
  expect(() => reader.read('meeting-a')).toThrow('corrupt tail')
  expect(() => reader.acquireWriter()).toThrow('read-only')
  expect(() => reader.commit({} as any)).toThrow('read-only')
  expect(reader.lastQuarantine).toBeNull()
  expect(readFileSync(path, 'utf8')).toBe(before)
  const missing = join(f.dir, 'not-created'); new MeetingJournal(missing, { readOnly: true })
  expect(existsSync(missing)).toBe(false)
})
