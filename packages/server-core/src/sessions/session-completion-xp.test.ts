import { afterEach, beforeEach, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getXpReward, loadGamificationState } from '@craft-agent/shared/gamification'
import { SessionManager, type SessionCompletionEvent } from './SessionManager.ts'

let root: string
let previousRox: string | undefined
let previousCraft: string | undefined
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'session-completion-xp-'))
  previousRox = process.env.ROX_CONFIG_DIR
  previousCraft = process.env.CRAFT_CONFIG_DIR
  process.env.ROX_CONFIG_DIR = root
  process.env.CRAFT_CONFIG_DIR = root
})
afterEach(() => {
  if (previousRox === undefined) delete process.env.ROX_CONFIG_DIR
  else process.env.ROX_CONFIG_DIR = previousRox
  if (previousCraft === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousCraft
  rmSync(root, { recursive: true, force: true })
})

function complete(manager: SessionManager, event: SessionCompletionEvent) {
  ;(manager as unknown as { emitSessionComplete(event: SessionCompletionEvent): void }).emitSessionComplete(event)
}

it('completion persists profile XP and continues fan-out after a listener failure', () => {
  const manager = new SessionManager()
  const events: SessionCompletionEvent[] = []
  manager.onSessionComplete(() => { throw new Error('consumer failed') })
  const unsubscribe = manager.onSessionComplete((event) => events.push(event))
  const event: SessionCompletionEvent = { sessionId: 's1', workspaceId: 'ws1', reason: 'complete' }
  expect(() => complete(manager, event)).not.toThrow()
  expect(events).toEqual([event])
  expect(loadGamificationState(root).xp).toBe(getXpReward('session_completed'))
  expect(loadGamificationState(root).recentEvents?.[0]?.type).toBe('session_completed')
  unsubscribe()
  complete(manager, { ...event, sessionId: 's2' })
  expect(events).toEqual([event])
  expect(loadGamificationState(root).xp).toBe(2 * getXpReward('session_completed'))
})

it('profile storage failure cannot prevent session completion delivery', () => {
  const blocked = join(root, 'not-a-directory')
  writeFileSync(blocked, 'occupied')
  process.env.ROX_CONFIG_DIR = blocked
  process.env.CRAFT_CONFIG_DIR = blocked
  const manager = new SessionManager()
  const events: SessionCompletionEvent[] = []
  manager.onSessionComplete((event) => events.push(event))
  const event: SessionCompletionEvent = { sessionId: 's1', workspaceId: 'ws1', reason: 'complete' }
  expect(() => complete(manager, event)).not.toThrow()
  expect(events).toEqual([event])
})
