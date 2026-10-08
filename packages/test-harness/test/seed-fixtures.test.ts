/** W1-10 self-test: seed determinism + migration/privacy/dock fixtures. */
import { describe, expect, test } from 'bun:test'
import { seedTwoUserWorkspace, SEED_TAG } from '../src/seed.ts'
import {
  V2_TASKS_FIXTURE,
  OKR_JSON_FIXTURE,
  ROADMAP_JSON_FIXTURE,
  DOSSIER_DUMP_FIXTURE,
  VAULT_NOTES_FIXTURE,
  TIPTAP_NODE_TYPES,
} from '../src/fixtures/migrations.ts'
import { PRIVACY_FIXTURES, PRIVACY_EXPECTATIONS } from '../src/fixtures/privacy.ts'
import { buildDockTable, dockTableInvariantHolds } from '../src/fixtures/dock.ts'

describe('seeded two-user workspace', () => {
  test('is deterministic and has two users, spaces and people', () => {
    const a = seedTwoUserWorkspace()
    const b = seedTwoUserWorkspace()
    expect(a).toEqual(b)
    expect(a.seedTag).toBe(SEED_TAG)
    expect(a.users.map((u) => u.handle)).toEqual(['@alice', '@bob'])
    expect(a.spaces.length).toBe(2)
    expect(a.dmChatId).toBeString()
  })
})

describe('migration fixtures', () => {
  test('v2 tasks carry schemaVersion 2', () => {
    expect(V2_TASKS_FIXTURE.length).toBeGreaterThan(0)
    for (const t of V2_TASKS_FIXTURE) expect(t.schemaVersion).toBe(2)
  })
  test('okr.json links a project-scoped goal', () => {
    expect(OKR_JSON_FIXTURE.objectives.some((o) => o.projectId)).toBe(true)
  })
  test('roadmap.json has milestones with due dates', () => {
    expect(ROADMAP_JSON_FIXTURE.milestones.length).toBeGreaterThan(0)
    for (const m of ROADMAP_JSON_FIXTURE.milestones) expect(m.dueDate).toBeString()
  })
  test('dossier dump is versioned', () => {
    expect(DOSSIER_DUMP_FIXTURE.version).toBe(1)
    expect(DOSSIER_DUMP_FIXTURE.contacts.length).toBeGreaterThan(0)
  })
  test('vault notes cover every TipTap node type incl. explicit link syntax', () => {
    const covered = new Set<string>()
    for (const note of VAULT_NOTES_FIXTURE) {
      for (const n of note.coveredNodes) covered.add(n)
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const c of node) walk(c)
          return
        }
        if (node && typeof node === 'object') {
          const rec = node as Record<string, unknown>
          if (typeof rec.type === 'string') covered.add(rec.type)
          walk(rec.content)
        }
      }
      walk(note.tiptap.content)
    }
    for (const t of TIPTAP_NODE_TYPES) expect(covered.has(t)).toBe(true)
    const md = VAULT_NOTES_FIXTURE.map((n) => n.markdown).join('\n')
    expect(md).toContain('[[goal:retention|Q4 retention]]')
    expect(md).toContain('![[task:task-001]]')
  })
})

describe('privacy + dock fixtures', () => {
  test('every privacy fixture has an expectation', () => {
    const refs = new Set(PRIVACY_EXPECTATIONS.map((e) => e.ref))
    for (const f of PRIVACY_FIXTURES) expect(refs.has(f.ref)).toBe(true)
  })
  test('dock table covers widths 960–2560 and MAIN ≥ 640 holds', () => {
    const table = buildDockTable()
    const widths = new Set(table.map((r) => r.width))
    expect(widths.has(960)).toBe(true)
    expect(widths.has(2560)).toBe(true)
    expect(dockTableInvariantHolds()).toBe(true)
  })
})
