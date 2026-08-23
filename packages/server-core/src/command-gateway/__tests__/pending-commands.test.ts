import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  PendingCommandsStore,
  sweepExpired,
  DEFAULT_COMMAND_TTL_MS,
} from '../pending-commands.ts'

/** RX-DOC-0032 phase 0: restart-safe pending-command store. */
describe('PendingCommandsStore', () => {
  let dir: string
  let store: PendingCommandsStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cmd-gw-'))
    store = new PendingCommandsStore(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const mkInput = (over: Partial<Parameters<PendingCommandsStore['create']>[0]> = {}) => ({
    workspaceId: 'ws-1',
    source: 'session' as const,
    appName: 'TestApp',
    command: 'rm -rf /tmp/x',
    reason: 'cleanup requested by flow',
    ...over,
  })

  it('create → pending, persisted atomically (tmp gone after save)', () => {
    const cmd = store.create(mkInput())
    expect(cmd.status).toBe('pending')
    expect(cmd.expiresAt - cmd.createdAt).toBe(DEFAULT_COMMAND_TTL_MS)
    expect(existsSync(store.path)).toBe(true)
    expect(existsSync(`${store.path}.tmp`)).toBe(false)
  })

  it('approve/deny only resolve own-workspace pending commands', () => {
    const cmd = store.create(mkInput())
    expect(store.decide(cmd.id, 'ws-other', 'approved', 'owner')).toBeNull()
    expect(store.decide(cmd.id, 'ws-1', 'denied', 'owner')?.status).toBe('denied')
    // Повторное решение по решённой — null
    expect(store.decide(cmd.id, 'ws-1', 'approved', 'owner')).toBeNull()
    expect(store.listPending('ws-1')).toHaveLength(0)
  })

  it('restart-safe: new store instance over same dir sees approved + sweeps expired', () => {
    const approved = store.create(mkInput({ appName: 'A' }))
    store.decide(approved.id, 'ws-1', 'approved', 'owner')

    const stale = store.create(mkInput({ appName: 'B', ttlMs: -1 })) // уже просрочен

    const reopened = new PendingCommandsStore(dir)
    expect(reopened.takeApproved(approved.id, 'ws-1')?.appName).toBe('A')
    expect(reopened.listPending('ws-1').find((c) => c.id === stale.id)).toBeUndefined()

    const raw = JSON.parse(readFileSync(reopened.path, 'utf8'))
    expect(raw.commands.find((c: { id: string }) => c.id === stale.id).status).toBe('expired')
  })

  it('sweepExpired marks only past-due pendings', () => {
    const now = 1_000_000
    const cmds = [
      { id: 'a', status: 'pending' as const, expiresAt: now - 1 },
      { id: 'b', status: 'pending' as const, expiresAt: now + 100 },
      { id: 'c', status: 'approved' as const, expiresAt: now - 1 },
    ] as Parameters<typeof sweepExpired>[0]
    const { kept, expiredCount } = sweepExpired(cmds, now)
    expect(expiredCount).toBe(1)
    expect(kept.find((c) => c.id === 'a')?.status).toBe('expired')
    expect(kept.find((c) => c.id === 'b')?.status).toBe('pending')
    expect(kept.find((c) => c.id === 'c')?.status).toBe('approved')
  })

  it('corrupt store file degrades to empty instead of throwing', () => {
    const p = join(dir, 'command-gateway', 'pending.json')
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, '{not json', 'utf8')
    const broken = new PendingCommandsStore(dir)
    expect(broken.listPending('ws-1')).toEqual([])
  })
})
