import { afterEach, describe, expect, it } from 'bun:test'
import { OmpAgent } from '../omp-agent'
import { cleanupModeState } from '../mode-manager'
import type { PermissionMode } from '../mode-types'
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli'

let fake: FakeOmp | undefined
let agent: OmpAgent | undefined
let restore: (() => void) | undefined
let sessionId: string | undefined

function setup() {
  fake = createFakeOmp('healthy')
  restore = useFakeOmpEnv(fake)
  const config = makeOmpConfig(fake)
  sessionId = `permission-mode-${crypto.randomUUID()}`
  config.session = { ...config.session!, id: sessionId }
  agent = new OmpAgent(config)
  return { agent, fake }
}

afterEach(() => {
  agent?.destroy()
  if (sessionId) cleanupModeState(sessionId)
  restore?.()
  fake?.cleanup()
  agent = undefined
  fake = undefined
  sessionId = undefined
  restore = undefined
})

describe('OMP permission mode child policy', () => {
  for (const [initial, next] of [['allow-all', 'safe'], ['safe', 'allow-all']] as const) {
    it(`respawns ${initial} as ${next} before the immediately following turn`, async () => {
      const { agent, fake } = setup()
      agent.setPermissionMode(initial)
      expect((await chatEvents(agent, 'first turn', 8_000)).some(event => event.type === 'text_complete')).toBe(true)
      expect(fake.readArgvLog()[0]!.includes('--approval-mode')).toBe(initial === 'allow-all')
      expect(fake.readArgvLog()[0]!.includes('yolo')).toBe(initial === 'allow-all')

      agent.setPermissionMode(next)
      const events = await chatEvents(agent, 'after mode change', 8_000)

      expect(agent.getPermissionMode()).toBe(next)
      expect(events.filter(event => event.type === 'error')).toEqual([])
      expect(events.some(event => event.type === 'text_complete')).toBe(true)
      expect(fake.readArgvLog()).toHaveLength(2)
      expect(fake.readArgvLog()[1]!.includes('--approval-mode')).toBe(next === 'allow-all')
      expect(fake.readArgvLog()[1]!.includes('yolo')).toBe(next === 'allow-all')
      expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(2)
    })
  }

  it('uses the latest mode after rapid changes without retiring the same child repeatedly', async () => {
    const { agent, fake } = setup()
    agent.setPermissionMode('allow-all')
    await chatEvents(agent, 'first turn', 8_000)
    for (const mode of ['safe', 'ask', 'allow-all', 'safe'] satisfies PermissionMode[]) {
      agent.setPermissionMode(mode)
    }
    const events = await chatEvents(agent, 'after rapid changes', 8_000)

    expect(events.filter(event => event.type === 'error')).toEqual([])
    expect(events.some(event => event.type === 'text_complete')).toBe(true)
    expect(agent.getPermissionMode()).toBe('safe')
    expect(fake.readArgvLog()).toHaveLength(2)
    expect(fake.readArgvLog()[1]).not.toContain('--approval-mode')
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(2)
  })

  it('keeps the child when changing between ask and safe', async () => {
    const { agent, fake } = setup()
    agent.setPermissionMode('ask')
    await chatEvents(agent, 'ask turn', 8_000)
    agent.setPermissionMode('safe')
    const events = await chatEvents(agent, 'safe turn', 8_000)

    expect(events.filter(event => event.type === 'error')).toEqual([])
    expect(events.some(event => event.type === 'text_complete')).toBe(true)
    expect(agent.getPermissionMode()).toBe('safe')
    expect(fake.readArgvLog()).toHaveLength(1)
    expect(fake.readRpcLog().filter(frame => frame.type === 'prompt')).toHaveLength(2)
  })
})
