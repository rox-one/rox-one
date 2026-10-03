import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteBroInviteStore } from '../durable-store.ts'
import { BroInviteStore } from '../store.ts'
import { parseInviteUrl, type JoinResult, type RoxAccount } from '../invite.ts'
import { DatabaseSync } from '../../utils/sqlite-runtime.ts'

const owner: RoxAccount = { accountId: 'owner', username: 'ada', displayName: 'Ada' }
const joiner: RoxAccount = { accountId: 'joiner', username: 'bro-two', displayName: 'Bro Two' }
const roots: string[] = []
const stores: SqliteBroInviteStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-bro-store-'))
  roots.push(root)
  return join(root, 'collaboration', 'bro-invites.sqlite')
}

function open(path: string, now: () => number = () => 100, randomBytes?: (n: number) => Uint8Array): SqliteBroInviteStore {
  const store = new SqliteBroInviteStore(path, now, randomBytes)
  stores.push(store)
  return store
}

function close(store: SqliteBroInviteStore): void {
  stores.splice(stores.indexOf(store), 1)
  store.close()
}

describe('durable Bro invitations', () => {
  it('survives restart, persists membership and cannot redeem a used invitation after a second restart', () => {
    const path = databasePath()
    let store = open(path)
    const card = store.createInvite({ sessionId: 'session-1', workspaceId: 'workspace-1', owner, role: 'viewer' })
    const key = parseInviteUrl(card.url)!.joinKey
    close(store)
    store = open(path, () => 101)
    expect(store.getInvite(key)).toMatchObject({ ownerAccountId: 'owner', workspaceId: 'workspace-1', role: 'viewer', expiresAt: card.expiresAt })
    expect(store.join(card.url, joiner)).toEqual({ ok: true, sessionId: 'session-1', workspaceId: 'workspace-1', accountId: 'joiner', role: 'viewer' })
    close(store)
    store = open(path, () => 102)
    expect(store.join(card.url, { ...joiner, accountId: 'other' })).toEqual({ ok: false, error: 'reused' })
    expect(store.listPresence('session-1', 'workspace-1')).toEqual([
      { ...owner, role: 'owner', status: 'offline', joinedAt: 100 },
      { ...joiner, role: 'viewer', status: 'offline', joinedAt: 101 },
    ])
    expect(store.listPresence('session-1')).toEqual([])
  })

  it('persists owner-only, idempotent revocation across independent instances', () => {
    const path = databasePath()
    const issuer = open(path)
    const receiver = open(path)
    const card = issuer.createInvite({ sessionId: 'session-1', owner })
    const key = parseInviteUrl(card.url)!.joinKey
    expect(receiver.revoke(key, 'joiner')).toBe(false)
    expect(receiver.join(card.url, null)).toEqual({ ok: false, error: 'membership_required' })
    expect(issuer.revoke(key, 'owner')).toBe(true)
    expect(receiver.revoke(key, 'owner')).toBe(true)
    expect(receiver.join(card.url, joiner)).toEqual({ ok: false, error: 'revoked' })
    close(issuer)
    close(receiver)
    expect(open(path).join(card.url, joiner)).toEqual({ ok: false, error: 'revoked' })
  })

  it('enforces exact expiry, account and URL checks without consuming invalid attempts', () => {
    const path = databasePath()
    const issuer = open(path)
    const card = issuer.createInvite({ sessionId: 'session-1', owner, ttlMs: 10 })
    const beforeExpiry = open(path, () => 109)
    expect(beforeExpiry.join(card.url, { ...joiner, accountId: ' ' })).toEqual({ ok: false, error: 'membership_required' })
    expect(beforeExpiry.join(card.url.replace('@ada', '@other'), joiner)).toEqual({ ok: false, error: 'invalid' })
    expect(beforeExpiry.join(card.url.replace('session-1', 'other-session'), joiner)).toEqual({ ok: false, error: 'invalid' })
    expect(beforeExpiry.getInvite(parseInviteUrl(card.url)!.joinKey)?.usedAt).toBeUndefined()
    const atExpiry = open(path, () => 110)
    expect(atExpiry.join(card.url, joiner)).toEqual({ ok: false, error: 'expired' })
    close(issuer)
    close(beforeExpiry)
    close(atExpiry)
    expect(open(path, () => 111).join(card.url, joiner)).toEqual({ ok: false, error: 'expired' })
  })

  it('namespaces memberships for identical session IDs in different workspaces in both stores', () => {
    for (const store of [new BroInviteStore(() => 100), open(databasePath())]) {
      const first = store.createInvite({ sessionId: 'same-id', workspaceId: 'workspace-a', owner })
      const second = store.createInvite({ sessionId: 'same-id', workspaceId: 'workspace-b', owner: { ...owner, accountId: 'different-owner' } })
      expect(store.join(first.url, joiner)).toMatchObject({ ok: true, workspaceId: 'workspace-a' })
      expect(store.join(second.url, { ...joiner, accountId: 'different-joiner' })).toMatchObject({ ok: true, workspaceId: 'workspace-b' })
      expect(store.listPresence('same-id', 'workspace-a').map(member => member.accountId)).toEqual(['owner', 'joiner'])
      expect(store.listPresence('same-id', 'workspace-b').map(member => member.accountId)).toEqual(['different-owner', 'different-joiner'])
      expect(store.listPresence('same-id')).toEqual([])
    }
  })

  it('keeps bearer keys and URLs out of the database and restricts database/sidecar permissions', () => {
    const path = databasePath()
    const store = open(path)
    const card = store.createInvite({ sessionId: 'session-1', owner })
    const key = parseInviteUrl(card.url)!.joinKey
    for (const file of [path, `${path}-wal`, `${path}-shm`].filter(existsSync)) {
      expect(readFileSync(file).includes(Buffer.from(key))).toBe(false)
      expect(readFileSync(file).includes(Buffer.from(card.url))).toBe(false)
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    }
    if (process.platform !== 'win32') expect(statSync(join(path, '..')).mode & 0o777).toBe(0o700)
  })

  it('refuses unsafe files and never silently replaces corrupt or unavailable storage', () => {
    const path = databasePath()
    const target = join(roots.at(-1)!, 'target')
    writeFileSync(target, 'existing private data')
    if (process.platform !== 'win32') {
      const linked = join(roots.at(-1)!, 'linked.sqlite')
      symlinkSync(target, linked)
      expect(() => open(linked)).toThrow('private regular file')
      const hardLinked = join(roots.at(-1)!, 'hard-linked.sqlite')
      linkSync(target, hardLinked)
      expect(() => open(hardLinked)).toThrow('private regular file')
      expect(readFileSync(target, 'utf8')).toBe('existing private data')
    }
    expect(() => open(join(target, 'cannot-create.sqlite'))).toThrow()
    writeFileSync(path.replace('collaboration/bro-invites.sqlite', 'corrupt.sqlite'), 'not a sqlite database')
    expect(() => open(path.replace('collaboration/bro-invites.sqlite', 'corrupt.sqlite'))).toThrow()
    expect(readFileSync(target, 'utf8')).toBe('existing private data')
  })

  it('never overwrites used invitations when a random-key generator collides', () => {
    const store = open(databasePath(), () => 100, length => new Uint8Array(length).fill(7))
    const card = store.createInvite({ sessionId: 'session-1', owner })
    expect(store.join(card.url, joiner).ok).toBe(true)
    expect(() => store.createInvite({ sessionId: 'session-2', owner })).toThrow('unique invitation key')
    expect(store.join(card.url, joiner)).toEqual({ ok: false, error: 'reused' })
    expect(store.listPresence('session-2')).toEqual([])
  })

  it('retains owner/editor privileges when a lower-role invitation is redeemed', () => {
    const store = open(databasePath())
    const ownerInvite = store.createInvite({ sessionId: 'session-1', owner, role: 'viewer' })
    expect(store.join(ownerInvite.url, owner).ok).toBe(true)
    const editorInvite = store.createInvite({ sessionId: 'session-1', owner, role: 'editor' })
    expect(store.join(editorInvite.url, joiner).ok).toBe(true)
    const viewerInvite = store.createInvite({ sessionId: 'session-1', owner, role: 'viewer' })
    expect(store.join(viewerInvite.url, joiner).ok).toBe(true)
    expect(store.listPresence('session-1').map(member => member.role)).toEqual(['owner', 'editor'])
  })

  it('rolls back consumption if membership persistence fails and allows a later successful redemption', () => {
    const path = databasePath()
    const store = open(path)
    const card = store.createInvite({ sessionId: 'session-1', owner })
    const inspection = new DatabaseSync(path)
    try {
      inspection.exec(`CREATE TRIGGER fail_join BEFORE INSERT ON bro_members
        WHEN NEW.account_id = 'joiner' BEGIN SELECT RAISE(ABORT, 'membership storage rejected'); END;`)
      expect(() => store.join(card.url, joiner)).toThrow('membership storage rejected')
      expect(store.getInvite(parseInviteUrl(card.url)!.joinKey)?.usedAt).toBeUndefined()
      expect(store.listPresence('session-1')).toHaveLength(1)
      inspection.exec('DROP TRIGGER fail_join')
      expect(store.join(card.url, joiner).ok).toBe(true)
    } finally {
      inspection.close()
    }
  })
})

const fixture = join(import.meta.dir, 'durable-store.fixture.ts')

async function waitUntilReady(barrier: string, ids: string[]): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!ids.every(id => existsSync(`${barrier}.${id}.ready`))) {
    if (Date.now() >= deadline) throw new Error('invitation workers did not initialize')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  writeFileSync(barrier, 'start')
}

async function race(path: string, url: string, operations: Array<{ action: 'join' | 'revoke'; accountId: string }>, timestamp = 101): Promise<Array<JoinResult | { revoked: boolean }>> {
  const barrier = join(roots.at(-1)!, 'barrier')
  const workers = operations.map((operation, index) => Bun.spawn([
    process.execPath, fixture, path, operation.action, url, operation.accountId, String(timestamp), barrier, String(index),
  ], { stdout: 'pipe', stderr: 'pipe' }))
  try {
    await waitUntilReady(barrier, operations.map((_, index) => String(index)))
    return await Promise.all(workers.map(async worker => {
      const [output, error, code] = await Promise.all([new Response(worker.stdout).text(), new Response(worker.stderr).text(), worker.exited])
      expect({ code, error }).toEqual({ code: 0, error: '' })
      return JSON.parse(output)
    }))
  } finally {
    for (const worker of workers) worker.kill()
  }
}

it('redeems an invitation at most once when independent host processes race', async () => {
  const path = databasePath()
  const issuer = open(path)
  const card = issuer.createInvite({ sessionId: 'session-1', workspaceId: 'workspace-1', owner })
  close(issuer)
  const results = await race(path, card.url, [{ action: 'join', accountId: 'first' }, { action: 'join', accountId: 'second' }]) as JoinResult[]
  expect(results.filter(result => result.ok)).toHaveLength(1)
  expect(results.filter(result => !result.ok)).toEqual([{ ok: false, error: 'reused' }])
  expect(open(path).listPresence('session-1', 'workspace-1')).toHaveLength(2)
}, 10_000)

it('serializes revoke/join races and persists revocation without admitting later joins', async () => {
  const path = databasePath()
  const issuer = open(path)
  const card = issuer.createInvite({ sessionId: 'session-1', owner })
  close(issuer)
  const [joined, revoked] = await race(path, card.url, [{ action: 'join', accountId: 'joiner' }, { action: 'revoke', accountId: 'owner' }])
  const joinResult = joined as JoinResult
  expect(revoked).toEqual({ revoked: true })
  expect(joinResult.ok || joinResult.error === 'revoked').toBe(true)
  const store = open(path)
  expect(store.join(card.url, { ...joiner, accountId: 'later' })).toEqual({ ok: false, error: 'revoked' })
  expect(store.listPresence('session-1')).toHaveLength(joinResult.ok ? 2 : 1)
}, 10_000)

it('does not consume invitations when separate hosts race at the exact expiry boundary', async () => {
  const path = databasePath()
  const issuer = open(path)
  const card = issuer.createInvite({ sessionId: 'session-1', owner, ttlMs: 1 })
  close(issuer)
  const results = await race(path, card.url, [{ action: 'join', accountId: 'first' }, { action: 'join', accountId: 'second' }])
  expect(results).toEqual([{ ok: false, error: 'expired' }, { ok: false, error: 'expired' }])
  const store = open(path)
  expect(store.getInvite(parseInviteUrl(card.url)!.joinKey)?.usedAt).toBeUndefined()
  expect(store.listPresence('session-1')).toHaveLength(1)
}, 10_000)

it('redeems a Bun-issued invitation in a restarted Node host and preserves one-use on return to Bun', async () => {
  const path = databasePath()
  const issuer = open(path)
  const card = issuer.createInvite({ sessionId: 'session-1', owner })
  close(issuer)
  const built = join(roots.at(-1)!, 'fixture.mjs')
  const build = await Bun.build({ entrypoints: [fixture], target: 'node' })
  expect(build.success).toBe(true)
  await Bun.write(built, build.outputs[0]!)
  const child = Bun.spawn(['node', '--disable-warning=ExperimentalWarning', built, path, 'join', card.url, 'node-joiner', '101'], { stdout: 'pipe', stderr: 'pipe' })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, error }).toEqual({ code: 0, error: '' })
  expect(JSON.parse(output)).toMatchObject({ ok: true, accountId: 'node-joiner' })
  expect(open(path).join(card.url, joiner)).toEqual({ ok: false, error: 'reused' })
}, 10_000)
