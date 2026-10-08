/**
 * W1-06 (#1503) — PersonalTask v2 → WorkItem v3: MIG-01 / MIG-02 / MIG-03
 * fixtures + golden outputs + idempotent re-run, the v3 read/write API and
 * the "UI writes v2, v3-only fields survive" rule.
 *
 * Golden files: `fixtures/personal-tasks-v3-golden/*`. Regenerate with
 * `UPDATE_GOLDEN=1 bun test work-item-v3` after an intentional change.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { migrateTaskLinks, toWorkItem } from '@rox/core/tasks/personal'
import { PersonalTaskPersistStore } from '../personal-persist.ts'
import { readPersonalTasks } from '../personal-tasks-service.ts'
import { migratePersonalTaskLinks } from '../work-item-link-migration.ts'
import { EntityLinkStore } from '../../entities/link-store.ts'

const FIXTURES = join(import.meta.dir, 'fixtures', 'personal-tasks-v2')
const GOLDEN = join(import.meta.dir, 'fixtures', 'personal-tasks-v3-golden')
const update = process.env.UPDATE_GOLDEN === '1'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'w1-06-mig-'))
  cpSync(FIXTURES, root, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function golden(name: string, actual: unknown): void {
  const path = join(GOLDEN, name)
  const text = `${JSON.stringify(actual, null, 2)}\n`
  if (update || !existsSync(path)) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(path, text)
  }
  expect(text).toBe(readFileSync(path, 'utf8'))
}

function rawFile(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'personal-tasks', `${id}.json`), 'utf8')) as Record<string, unknown>
}

describe('MIG-01 / MIG-02 (v2 files → v3 in place)', () => {
  it('upgrades every task file and meta to the golden output without bumping revisions', () => {
    const store = new PersonalTaskPersistStore(root)
    const before = store.list()
    const reports = store.migrateToV3({ now: 1_800_000_000_000 })
    expect(reports.map(r => [r.id, r.scanned, r.upgraded, r.alreadyCurrent, r.failed.length])).toEqual([
      ['MIG-01', 3, 3, 0, 0],
      ['MIG-02', 1, 1, 0, 0],
    ])
    for (const id of ['t-open', 't-done', 't-cancel']) golden(`${id}.json`, rawFile(id))
    golden('personal-tasks-meta.json', JSON.parse(readFileSync(join(root, 'personal-tasks-meta.json'), 'utf8')))
    // The UI view (v2 task + revision) is byte-for-byte what it was.
    expect(store.list()).toEqual(before)
    expect(store.readMeta()).toEqual({
      projects: [{ id: 'p-work', name: 'Work', areaId: 'a-home', order: 1, notes: 'n', deadlineAt: 1_795_000_000_000, createdAt: 1_760_000_000_000 }],
      areas: [{ id: 'a-home', name: 'Home', order: 0, collapsed: true }],
      headings: [{ id: 'h-plan', title: 'Planning', projectId: 'p-work', order: 3 }],
      audit: [{ at: 1, action: 'x' }],
    })
    expect(existsSync(store.migrationReportPath('MIG-01'))).toBe(true)
    expect(store.isMigratedToV3()).toBe(true)
  })

  it('is idempotent: a re-run changes nothing', () => {
    const store = new PersonalTaskPersistStore(root)
    store.migrateToV3({ now: 1 })
    const snapshot = readdirSync(join(root, 'personal-tasks')).sort().map(name => readFileSync(join(root, 'personal-tasks', name), 'utf8'))
    const meta = readFileSync(join(root, 'personal-tasks-meta.json'), 'utf8')
    const again = store.migrateToV3({ now: 2 })
    expect(again.map(r => [r.upgraded, r.alreadyCurrent])).toEqual([[0, 3], [0, 1]])
    expect(readdirSync(join(root, 'personal-tasks')).sort().map(name => readFileSync(join(root, 'personal-tasks', name), 'utf8'))).toEqual(snapshot)
    expect(readFileSync(join(root, 'personal-tasks-meta.json'), 'utf8')).toBe(meta)
  })

  it('dry run counts but writes nothing', () => {
    const store = new PersonalTaskPersistStore(root)
    const before = rawFile('t-open')
    const reports = store.migrateToV3({ dryRun: true })
    expect(reports[0]!.upgraded).toBe(3)
    expect(rawFile('t-open')).toEqual(before)
    expect(existsSync(store.migrationReportPath('MIG-01'))).toBe(false)
  })

  it('the service backs up v2 files verbatim first, then migrates once', () => {
    const store = new PersonalTaskPersistStore(root)
    const v2 = readFileSync(join(root, 'personal-tasks', 't-open.json'), 'utf8')
    const snapshot = readPersonalTasks(store)
    expect(snapshot.tasks.map(t => t.id).sort()).toEqual(['t-cancel', 't-done', 't-open'])
    expect(snapshot.revisions).toEqual({ 't-cancel': 7, 't-done': 1, 't-open': 4 })
    const backups = readdirSync(join(root, 'personal-tasks-backups'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(root, 'personal-tasks-backups', backups[0]!, 'personal-tasks', 't-open.json'), 'utf8')).toBe(v2)
    expect(rawFile('t-open').schemaVersion).toBe(3)
  })

  it('an unreadable task file is skipped (not failed), so the migration settles', () => {
    writeFileSync(join(root, 'personal-tasks', 't-broken.json'), '{ "id": "t-broken", ')
    const store = new PersonalTaskPersistStore(root)
    const [tasks] = store.migrateToV3({ now: 1 })
    expect(tasks).toMatchObject({ scanned: 4, upgraded: 3, failed: [], skipped: ['t-broken'] })
    expect(store.isMigratedToV3()).toBe(true)
    expect(readFileSync(join(root, 'personal-tasks', 't-broken.json'), 'utf8')).toBe('{ "id": "t-broken", ')
  })

  it('a corrupt work half is re-derived, never drops the task', () => {
    const file = rawFile('t-open')
    writeFileSync(join(root, 'personal-tasks', 't-open.json'), JSON.stringify({ ...file, schemaVersion: 3, work: { statusKey: 7 } }))
    const store = new PersonalTaskPersistStore(root)
    expect(store.get('t-open')?.revision).toBe(4)
    expect(store.getWorkItem('t-open')?.item.statusKey).toBe('pending')
    expect(store.migrateToV3()[0]!.upgraded).toBe(3)
  })
})

describe('WorkItem v3 view and writes', () => {
  it('maps v2 fields through the read aliases (MIG-01 rules)', () => {
    const store = new PersonalTaskPersistStore(root)
    const open = store.getWorkItem('t-open')!.item
    expect(open).toMatchObject({
      authority: 'local', ownerPrincipalId: 'local', statusKey: 'pending', priority: 'normal', assigneeIds: [],
      listId: 'p-work', sectionId: 'h-plan', dueAt: new Date(1_790_000_000_000).toISOString(), origin: { kind: 'call', id: 'call-7' },
    })
    expect(store.getWorkItem('t-done')!.item).toMatchObject({ statusKey: 'done', priority: 'high', listGroupId: 'a-home' })
    expect(store.getWorkItem('t-cancel')!.item).toMatchObject({ statusKey: 'canceled', priority: 'low' })
  })

  it('UI (v2) writes keep v3-only fields and recompute derived ones', () => {
    const store = new PersonalTaskPersistStore(root)
    const current = store.getWorkItem('t-open')!
    const written = store.putWorkItem({ ...current.item, assigneeIds: ['p-1'], size: 'm', priority: 'urgent', statusKey: 'in_progress' }, current.revision)
    expect(written.status).toBe('accepted')
    if (written.status !== 'accepted') return
    expect(written.record.revision).toBe(5)
    // The UI sees `high` for `urgent` and is otherwise unchanged.
    const uiTask = store.get('t-open')!.task
    expect(uiTask.priority).toBe('high')
    store.put({ ...uiTask, title: 'Draft the Q4 plan (v2)', completedAt: 1_790_000_100_000 })
    const after = store.getWorkItem('t-open')!.item
    expect(after).toMatchObject({ title: 'Draft the Q4 plan (v2)', assigneeIds: ['p-1'], size: 'm', priority: 'urgent', statusKey: 'done' })
    // Reopen in the UI: done → pending (the open custom key is not resurrected).
    store.put({ ...store.get('t-open')!.task, completedAt: undefined })
    expect(store.getWorkItem('t-open')!.item.statusKey).toBe('pending')
    // Lowering priority in the UI drops the urgent override.
    store.put({ ...store.get('t-open')!.task, priority: 'low' })
    expect(store.getWorkItem('t-open')!.item.priority).toBe('low')
  })

  it('putWorkItem is CAS: stale revisions conflict, create-only needs null', () => {
    const store = new PersonalTaskPersistStore(root)
    const current = store.getWorkItem('t-open')!
    expect(store.putWorkItem({ ...current.item, title: 'x' }, 3).status).toBe('conflict')
    expect(store.putWorkItem({ ...current.item, id: 'fresh' }, 4).status).toBe('conflict')
    const created = store.putWorkItem({ ...current.item, id: 'fresh', legacyLinks: undefined }, null)
    expect(created.status === 'accepted' && created.record.revision).toBe(1)
    // Identical write: no bump.
    const same = store.putWorkItem(store.getWorkItem('fresh')!.item, 1)
    expect(same.status === 'accepted' && same.record.revision).toBe(1)
  })

  it('a status closed through the v3 API stamps the v2 lifecycle fields', () => {
    const store = new PersonalTaskPersistStore(root)
    const current = store.getWorkItem('t-open')!
    store.putWorkItem({ ...current.item, statusKey: 'canceled', cancelledAt: '2026-10-08T10:00:00.000Z' }, current.revision)
    const task = store.get('t-open')!.task
    expect(task.cancelledAt).toBe(Date.parse('2026-10-08T10:00:00.000Z'))
    expect(task.completedAt).toBeUndefined()
  })

  it('new v2 writes are stored as v3 files', () => {
    const store = new PersonalTaskPersistStore(root)
    const task: PersonalTask = { id: 'new', title: 'N', notes: '', list: 'inbox', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 1 }
    store.put(task)
    expect(rawFile('new')).toMatchObject({ schemaVersion: 3, revision: 1, task, work: { authority: 'local', statusKey: 'pending', assigneeIds: [] } })
    expect(toWorkItem(task, 1).priority).toBe('none')
  })

  it('readWorkMeta derives lists / sections / groups from a v2 meta file (read alias)', () => {
    const store = new PersonalTaskPersistStore(root)
    const work = store.readWorkMeta()
    expect(work.taskLists.map(l => [l.id, l.ownerType, l.groupId])).toEqual([['p-work', 'user', 'a-home']])
    expect(work.taskSections.map(s => [s.id, s.taskListId])).toEqual([['h-plan', 'p-work']])
    expect(work.taskListGroups.map(g => [g.id, g.collapsed])).toEqual([['a-home', true]])
    expect(work.taskLists[0]!.sortKey < work.taskSections[0]!.sortKey).toBe(true)
  })
})

describe('MIG-03 (TaskLink / source → entity_link)', () => {
  it('maps every TaskLink kind per DATA-MODEL §6.2', () => {
    const store = new PersonalTaskPersistStore(root)
    golden('mig-03-edges.json', store.list().map(({ task }) => ({ id: task.id, edges: migrateTaskLinks(task) })))
  })

  it('writes edges into the local link store once (idempotent re-run, no revision bumps)', () => {
    const store = new PersonalTaskPersistStore(root)
    const links = new EntityLinkStore({ workspaceRoot: join(root, 'ws') })
    try {
      const first = migratePersonalTaskLinks(store, links, { now: 5 })
      expect([first.tasks, first.edges, first.added, first.existing, first.failed.length]).toEqual([2, 9, 9, 0, 0])
      const revisions = links.outgoing({ kind: 'task', id: 't-open' }).map(l => l.revision)
      const second = migratePersonalTaskLinks(store, links, { now: 6 })
      expect([second.added, second.existing]).toEqual([0, 9])
      expect(links.outgoing({ kind: 'task', id: 't-open' }).map(l => l.revision)).toEqual(revisions)
      expect(links.outgoing({ kind: 'task', id: 't-open' }).find(l => l.relation === 'derived-from' && l.role === 'origin')?.to).toEqual({ kind: 'call', id: 'call-7' })
      // v2 links stay on the record (read-only one release).
      expect(store.get('t-open')!.task.links).toHaveLength(3)
      expect(existsSync(store.migrationReportPath('MIG-03'))).toBe(true)
    } finally {
      links.close?.()
    }
  })
})
