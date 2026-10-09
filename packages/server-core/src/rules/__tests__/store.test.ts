/**
 * W1-12 (#1509) — the local `SqliteRulesStore` keeps the step `plan` across
 * write→read, so a restart can re-drive a pending execution
 * (`engine.resumePending` → `dispatchStep` needs `step.plan`, DATA-MODEL §5.16).
 *
 * Regression for review B1: `toStepRecord()` dropped `plan`, so every read
 * (`get`/`list`/`pending`) returned steps without a plan and the engine failed
 * them with `no planned command to resume`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandEnvelope } from '@rox/core/commands'
import type { RuleExecutionRecord, RuleStepPlan } from '@rox/core/automation'
import { defaultRuleSettings } from '@rox/core/automation'
import { SqliteRulesStore } from '../store'
import { RuleEngine } from '../engine'

const WS = 'ws-1'
const SUBJECT = 'principal-mark'
const KEY = 'R1:event-1:single:principal-mark'
const NOW = '2026-10-08T09:00:00.000Z'

const SYSTEM_PLAN: RuleStepPlan = {
  type: 'task_lists.ensure_system_list',
  payload: { workspaceId: WS },
  actor: 'system',
  subject: SUBJECT,
}

const AGENT_PLAN: RuleStepPlan = {
  type: 'docs.create_meeting_notes',
  payload: { eventRef: { kind: 'calendar-event', id: 'event-1' }, id: 'note-1', title: 'Планёрка' },
  target: { kind: 'calendar-event', id: 'event-1' },
  authorityHint: 'local',
  actor: { agentOf: SUBJECT },
  subject: SUBJECT,
  optional: true,
}

function runningExecution(): RuleExecutionRecord {
  return {
    ruleExecutionId: randomUUID(),
    workspaceId: WS,
    ruleId: 'R1',
    idempotencyKey: KEY,
    sourceEventId: 'evt-1',
    status: 'running',
    steps: [
      { action: 'ensure-list', command_id: `${KEY}:ensure-list`, status: 'pending', plan: SYSTEM_PLAN },
      { action: 'create-note', command_id: `${KEY}:create-note`, status: 'pending', plan: AGENT_PLAN },
    ],
    attempts: 1,
    createdAt: NOW,
  }
}

let root: string

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rox-rules-store-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('SqliteRulesStore execution plan', () => {
  test('the plan survives claim → get/pending→read', async () => {
    const store = new SqliteRulesStore({ workspaceRoot: root })
    const execution = runningExecution()
    const claim = await store.claim(execution)
    expect(claim.inserted).toBe(true)

    const planned = execution.steps.map(step => step.plan)
    const viaGet = await store.get(WS, KEY)
    expect(viaGet?.steps.map(step => step.plan)).toEqual(planned)

    const viaList = await store.list(WS)
    expect(viaList.map(record => record.steps.map(step => step.plan))).toEqual([planned])

    const [viaPending] = await store.pending(WS)
    expect(viaPending?.steps.map(step => step.plan)).toEqual(planned)
    store.close()
  })

  test('restart-resume re-drives a pending execution from the stored plan', async () => {
    // Claim as the engine would on the first attempt, then drop the store.
    const first = new SqliteRulesStore({ workspaceRoot: root })
    await first.claim(runningExecution())
    first.close()

    // Restart: a fresh store on the same file (same object store, new handle).
    let clock = new Date(NOW)
    const store = new SqliteRulesStore({ workspaceRoot: root })
    const dispatched: CommandEnvelope[] = []
    const engine = new RuleEngine({
      workspaceId: WS,
      executions: store,
      authorityHint: 'local',
      dispatch: async ({ envelope }) => {
        dispatched.push(envelope)
        return { commandId: envelope.commandId, status: 'applied', ref: { kind: 'task', id: envelope.commandId } }
      },
      now: () => clock,
      settings: async ruleId => defaultRuleSettings(ruleId),
      isFlagEnabled: flag => flag === 'automation.rules.v1',
      generalChatId: async () => undefined,
      personalAgent: async id => `R-agent:${WS}:${id}`,
      directChatRef: async () => undefined,
      displayName: async () => undefined,
    })

    // Backoff gate: too early to retry.
    expect(await engine.resumePending()).toEqual([])

    // Past the 60s backoff: the pending step is re-dispatched from its plan.
    clock = new Date(Date.parse(NOW) + 60_000)
    const outcomes = await engine.resumePending()
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ status: 'succeeded', duplicate: false })
    expect(dispatched.map(envelope => envelope.type)).toEqual([
      'task_lists.ensure_system_list', 'docs.create_meeting_notes',
    ])
    expect(await store.get(WS, KEY)).toMatchObject({ status: 'succeeded', attempts: 2 })
    store.close()
  })
})