import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerEnvironmentHandlers } from '../environment'
import type { RpcServer } from '@craft-agent/server-core/transport'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness() {
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  registerEnvironmentHandlers(server as unknown as RpcServer, {
    platform: { logger: console },
  } as never)
  return handlers
}

describe('environment RPC', () => {
  it('returns unseen defaults so Rox stays usable before the questionnaire', async () => {
    const handlers = createHarness()
    const payload = await handlers.get(RPC_CHANNELS.environment.GET)!({}) as {
      prefs: { seenVersion: number }
      pendingQuestionIds: string[]
    }
    expect(payload.prefs.seenVersion).toBe(0)
    expect(payload.pendingQuestionIds.length).toBeGreaterThan(0)
  })

  it('records a skip of optional questions without dropping answered ones', async () => {
    const handlers = createHarness()
    const saved = await handlers.get(RPC_CHANNELS.environment.SAVE)!({}, {
      modelPlacement: { status: 'answered', value: 'local' },
      completeQuestionnaire: true,
    }) as {
      prefs: { modelPlacement: { value: string }; wakeWord: { status: string }; seenVersion: number }
      pendingQuestionIds: string[]
    }
    expect(saved.prefs.modelPlacement.value).toBe('local')
    expect(saved.prefs.wakeWord.status).toBe('skipped')
    expect(saved.pendingQuestionIds).toEqual([])
    expect(saved.prefs.seenVersion).toBe(1)
  })
})
