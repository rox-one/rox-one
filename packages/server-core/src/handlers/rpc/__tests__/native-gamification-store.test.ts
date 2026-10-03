import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { NativeGamificationStore } from '../native-gamification'
import { awardNativeXpAndBroadcast } from '../gamification'
import type { NativePrincipal } from '../../../authority/native-authority'
import type { HandlerDeps } from '../../handler-deps'
import type { RequestContext, RpcServer } from '../../../transport/types'
const alice: NativePrincipal = { issuer: 'fixture-issuer', subject: 'alice', credentialId: 'a', credentialVersion: 1 }
const bob: NativePrincipal = { ...alice, subject: 'bob', credentialId: 'b' }
const cleanup: Array<() => void> = []
afterEach(() => { for (const action of cleanup.splice(0).reverse()) action() })
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'native-xp-store-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true })); return dir }
const open = (dir: string) => { const store = new NativeGamificationStore(dir); cleanup.push(() => store.close()); return store }

describe('transactional native XP receipts', () => {
  it('deduplicates committed events between independent store connections and marks onboarding achievements', () => {
    const dir = directory(), first = open(dir), second = open(dir)
    expect(first.award(alice, 'first_note', 'workspace/note-id').awarded).toBe(15)
    expect(second.award(alice, 'first_note', 'workspace/another-note-id').awarded).toBe(0)
    expect(second.quest(alice, 'complete', 'first_note', {}).state.xp).toBe(15)
    expect(first.award(alice, 'note_linked', 'canonical-edge-1').awarded).toBe(10)
    expect(second.award(alice, 'note_linked', 'canonical-edge-1').awarded).toBe(0)
    expect(first.award(alice, 'note_linked', 'canonical-edge-2').awarded).toBe(10)
    expect(first.award(alice, 'session_completed', 'real-user-id/real-final-id').awarded).toBe(25)
    expect(second.award(alice, 'session_completed', 'real-user-id/real-final-id').awarded).toBe(0)
    expect(second.read(alice).xp).toBe(60)
    expect(second.read(alice).quests.first_link.status).toBe('completed')
    expect(second.award(alice, 'session_completed', 'next-user-id/next-final-id').awarded).toBe(25)
    expect(second.award(bob, 'session_completed', 'real-user-id/real-final-id').awarded).toBe(25)
    expect(first.read(alice).xp).toBe(85)
    expect(first.read(bob).xp).toBe(25)
  })
  it('rejects a symlinked private store directory and database', () => {
    const dir = directory(), foreign = directory()
    symlinkSync(foreign, join(dir, 'native-gamification'))
    expect(() => new NativeGamificationStore(dir)).toThrow('custody directory')
    rmSync(join(dir, 'native-gamification')); mkdirSync(join(dir, 'native-gamification'))
    writeFileSync(join(foreign, 'database'), '')
    symlinkSync(join(foreign, 'database'), join(dir, 'native-gamification/progress.sqlite'))
    expect(() => new NativeGamificationStore(dir)).toThrow('custody file')
  })
  it('rejects damaged stored achievements without resetting earned XP or crashing profile rendering', () => {
    const dir = directory(), store = open(dir)
    store.award(alice, 'session_completed', 'committed-session')
    const db = new DatabaseSync(join(dir, 'native-gamification/progress.sqlite'))
    try {
      const actor = createHash('sha256').update(JSON.stringify(['native-xp-v1', alice.issuer, alice.subject])).digest('hex')
      const damaged = { ...store.read(alice), quests: {} }
      db.prepare('UPDATE progress SET state_json=? WHERE actor_hash=?').run(JSON.stringify(damaged), actor)
      expect(() => store.read(alice)).toThrow('Native XP state is invalid')
      const raw = db.prepare('SELECT state_json FROM progress WHERE actor_hash=?').get(actor)
      expect(JSON.parse(String(raw?.state_json)).xp).toBe(25)
    } finally { db.close() }
  })
  it('fails closed when authorizer returns false or the original current context guard is absent/stale', () => {
    const ctx: RequestContext = { principal: alice, workspaceId: 'own', clientId: 'minted-client', webContentsId: null }
    let pushCalls = 0
    const server = { push() { pushCalls++ }, isRequestContextCurrent: () => true } as unknown as RpcServer
    const deps = { nativeData: { authority: { authorize: () => false } } } as unknown as HandlerDeps
    expect(awardNativeXpAndBroadcast(server, deps, ctx, 'session_completed', 'receipt')).toBeNull()
    const allowed = { nativeData: { authority: { authorize: () => true } } } as unknown as HandlerDeps
    expect(awardNativeXpAndBroadcast({ push() { pushCalls++ } } as unknown as RpcServer, allowed, ctx, 'session_completed', 'receipt')).toBeNull()
    expect(awardNativeXpAndBroadcast({ ...server, isRequestContextCurrent: () => false } as unknown as RpcServer, allowed, ctx, 'session_completed', 'receipt')).toBeNull()
    expect(pushCalls).toBe(0)
  })
})
