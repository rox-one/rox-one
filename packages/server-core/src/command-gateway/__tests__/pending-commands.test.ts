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

describe('pending commands adversarial round (inline review)', () => {
  it('store file is created 0600', async () => {
    const { PendingCommandsStore } = await import('../pending-commands.ts')
    const { mkdtempSync, statSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'gw-mode-'))
    const store = new PendingCommandsStore(dir)
    store.create({ workspaceId: 'w', source: 'session', appName: 'app', command: 'ls', reason: 'r' })
    const st = statSync(join(dir, 'command-gateway', 'pending.json'))
    expect(st.mode & 0o777).toBe(0o600)
    rmSync(dir, { recursive: true, force: true })
  })

  it('terminal entries older than retention are pruned on next load', async () => {
    const { sweepExpired, pruneTerminal } = await import('../pending-commands.ts')
    const now = Date.now()
    const cmds = [
      { id: 'a', workspaceId: 'w', source: 'session' as const, appName: 'x', command: 'c', reason: 'r', createdAt: now - 1000, expiresAt: now + 100000, status: 'approved' as const, decidedBy: 'o', decidedAt: now - 25 * 3600 * 1000 },
      { id: 'b', workspaceId: 'w', source: 'session' as const, appName: 'x', command: 'c', reason: 'r', createdAt: now - 1000, expiresAt: now + 100000, status: 'pending' as const },
    ]
    const pruned = pruneTerminal(cmds, now)
    expect(pruned.prunedCount).toBe(1)
    expect(pruned.kept.length).toBe(1)
    expect(pruned.kept[0].id).toBe('b')
  })
})
