/** W1-06 (#1503) — MIG-04 lenient OKR reader. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createOkrCycle, readProjectOkrLenient, saveProjectOkr } from '../okr.ts'
import { createProject, getProjectPath } from '../storage.ts'

let root: string
let slug: string
let projectId: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'okr-lenient-'))
  const project = createProject(root, { name: 'Lenient' })
  slug = project.slug
  projectId = project.id
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (value: unknown) => writeFileSync(join(getProjectPath(root, slug), 'okr.json'), typeof value === 'string' ? value : JSON.stringify(value))

describe('readProjectOkrLenient', () => {
  it('returns null without a project or okr.json', () => {
    expect(readProjectOkrLenient(root, 'missing')).toBeNull()
    expect(readProjectOkrLenient(root, slug)).toBeNull()
  })

  it('returns the strict document untouched when it validates', () => {
    const cycle = createOkrCycle(projectId, { title: 'Q1', startDate: '2026-01-01', endDate: '2026-03-31' })
    saveProjectOkr(root, slug, 0, { cycles: [cycle] })
    const read = readProjectOkrLenient(root, slug)!
    expect(read.lenient).toBe(false)
    expect(read.dropped).toEqual([])
    expect(read.document.cycles.map(c => c.id)).toEqual([cycle.id])
  })

  it('keeps usable items of an invalid file and lists what it skipped', () => {
    write({ projectId: 'stale-id', revision: 2, cycles: [
      { id: 'c1', title: 'Draft', startDate: '2026-02-01', endDate: '2026-01-01', status: 'weird', objectives: [
        { id: 'o1', title: 'Grow', weight: -1, keyResults: [
          { id: 'k1', title: 'Users', measurement: { kind: 'numeric', baseline: 10, target: 2, current: 'n/a', unit: 5 } },
          { id: 'k2', title: 'Done?', measurement: { kind: 'binary', achieved: 'yes', evidence: [{ id: 'e', label: '' }] } },
          { id: 'k3', title: 'Broken', measurement: { kind: 'numeric', baseline: 'x', target: 2 } },
        ] },
      ] },
      { title: 'No id' },
    ] })
    const read = readProjectOkrLenient(root, slug)!
    expect(read.lenient).toBe(true)
    expect(read.dropped).toEqual(['objective o1: unusable key result', 'cycle without a unique id'])
    const [cycle] = read.document.cycles
    expect(read.document.projectId).toBe(projectId)
    expect(cycle).toMatchObject({ id: 'c1', projectId, status: 'draft', timezone: 'UTC' })
    expect(cycle!.objectives[0]).toMatchObject({ id: 'o1', weight: 1 })
    expect(cycle!.objectives[0]!.keyResults.map(k => k.measurement)).toEqual([
      { kind: 'numeric', direction: 'decrease', baseline: 10, target: 2, current: null, unit: '', evidence: [] },
      { kind: 'binary', achieved: null, evidence: [] },
    ])
  })

  it('reports unreadable JSON as an empty document', () => {
    write('{ nope')
    expect(readProjectOkrLenient(root, slug)).toEqual({ document: { projectId, revision: 0, cycles: [] }, dropped: ['okr.json is not valid JSON'], lenient: true })
  })
})
