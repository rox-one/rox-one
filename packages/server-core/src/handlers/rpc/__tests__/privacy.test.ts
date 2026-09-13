import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setOwnedRootAdapter } from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { HANDLED_CHANNELS, registerPrivacyHandlers } from '../privacy'

type Handler = (ctx: { workspaceId?: string }, ...args: unknown[]) => Promise<unknown>

function mockServer() {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{ channel: string; payload: unknown }> = []
  const server = {
    handle(channel: string, fn: Handler) {
      handlers.set(channel, fn)
    },
    push(channel: string, _target: unknown, payload: unknown) {
      pushes.push({ channel, payload })
    },
  }
  return { server, handlers, pushes }
}

describe('privacy RPC', () => {
  const dirs: string[] = []
  afterEach(() => {
    setOwnedRootAdapter(null)
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('registers the consent ledger channels and revokes sync without wiping local state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-privacy-rpc-'))
    dirs.push(dir)
    setOwnedRootAdapter({ resolveConfigDir: () => dir })
    const { server, handlers, pushes } = mockServer()
    registerPrivacyHandlers(server as never, {} as never)
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.privacy.GET,
      RPC_CHANNELS.privacy.SET_PURPOSE,
      RPC_CHANNELS.privacy.REQUEST_EXPORT,
      RPC_CHANNELS.privacy.REQUEST_DELETION,
      RPC_CHANNELS.privacy.COMPLETE_DELETION,
    ])
    for (const channel of HANDLED_CHANNELS) expect(handlers.has(channel)).toBe(true)

    const get = handlers.get(RPC_CHANNELS.privacy.GET)!
    const initial = (await get({})) as { purposes: Record<string, boolean> }
    expect(initial.purposes.realtimeSync).toBe(false)

    const setPurpose = handlers.get(RPC_CHANNELS.privacy.SET_PURPOSE)!
    await setPurpose({}, { purpose: 'accountRecoveryReplica', granted: true })
    const enabled = (await setPurpose({}, { purpose: 'realtimeSync', granted: true })) as {
      purposes: { realtimeSync: boolean }
    }
    expect(enabled.purposes.realtimeSync).toBe(true)

    const revoked = (await setPurpose({}, { purpose: 'realtimeSync', granted: false })) as {
      purposes: { realtimeSync: boolean; accountRecoveryReplica: boolean }
    }
    expect(revoked.purposes.realtimeSync).toBe(false)
    expect(revoked.purposes.accountRecoveryReplica).toBe(true)

    const del = handlers.get(RPC_CHANNELS.privacy.REQUEST_DELETION)!
    const queued = (await del({})) as {
      deletionReceipt: { status: string; localDataKept: boolean }
    }
    expect(queued.deletionReceipt.status).toBe('queued')
    expect(queued.deletionReceipt.localDataKept).toBe(true)
    expect(pushes.some((row) => row.channel === RPC_CHANNELS.privacy.CHANGED)).toBe(true)
  })
})
