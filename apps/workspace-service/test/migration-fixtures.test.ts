/**
 * W1-10 (#1507) — migration fixture validity (golden inputs for W1-06).
 *
 * Asserts the shapes wave-2 migration tests will consume: v2 tasks,
 * okr.json, roadmap.json, the Dossier dump and the vault-notes TipTap
 * coverage. Golden outputs and the idempotent re-run belong to #1503.
 */
import { describe, expect, test } from 'bun:test'
import {
  V2_TASKS_FIXTURE,
  OKR_JSON_FIXTURE,
  ROADMAP_JSON_FIXTURE,
  DOSSIER_DUMP_FIXTURE,
  VAULT_NOTES_FIXTURE,
} from '@rox/test-harness'

describe('migration fixtures', () => {
  test('v2 tasks are backward-readable (id present, done boolean)', () => {
    for (const t of V2_TASKS_FIXTURE) {
      expect(t.id).toBeString()
      expect(typeof t.done).toBe('boolean')
    }
  })

  test('okr.json references resolve within the fixture', () => {
    const cycles = new Set(OKR_JSON_FIXTURE.cycles.map((c) => c.id))
    const objectives = new Set(OKR_JSON_FIXTURE.objectives.map((o) => o.id))
    for (const o of OKR_JSON_FIXTURE.objectives) expect(cycles.has(o.cycleId)).toBe(true)
    for (const kr of OKR_JSON_FIXTURE.keyResults) expect(objectives.has(kr.objectiveId)).toBe(true)
  })

  test('roadmap milestones reference known tasks', () => {
    const tasks = new Set(V2_TASKS_FIXTURE.map((t) => t.id))
    for (const m of ROADMAP_JSON_FIXTURE.milestones) {
      for (const id of m.taskIds) expect(tasks.has(id)).toBe(true)
    }
  })

  test('dossier contacts have stable ids', () => {
    const ids = DOSSIER_DUMP_FIXTURE.contacts.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('vault notes embed explicit entity syntax', () => {
    const md = VAULT_NOTES_FIXTURE.map((n) => n.markdown).join('\n')
    expect(md).toContain('[[')
    expect(md).toContain('![[')
  })
})
