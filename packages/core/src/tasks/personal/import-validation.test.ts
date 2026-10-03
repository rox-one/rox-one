import { describe, expect, test } from 'bun:test'
import { PersonalTaskStore } from './store.ts'
import { loadPersonalTaskCache, persistPersonalTaskCache, PERSONAL_TASKS_STORAGE_KEY, PERSONAL_TASKS_QUARANTINE_KEY, PERSONAL_TASKS_STAGING_KEY } from './cache.ts'
function fixture() {
  const store = new PersonalTaskStore()
  const area = store.addArea('Area'); const project = store.addProject('Project', area.id); const heading = store.addHeading('Heading', project.id)
  store.create({ id: 'task-a', title: 'All current metadata', notes: 'Markdown', tags: ['one'], list: 'upcoming', priority: 'high', projectId: project.id, areaId: area.id, headingId: heading.id,
    dueAt: 0, startAt: 1, evening: true, now: 2, checklist: [{ id: 'check', title: 'Step', done: false }], reminderAt: 3, reminderTimeZone: 'Europe/Moscow',
    recurrence: { rule: 'weekly', interval: 2, weekdays: [0, 6], mode: 'after', until: 20, timeZone: 'Europe/Moscow' },
    links: ['note', 'session', 'message', 'workflowRun', 'meeting', 'feed', 'mail', 'decision'].map((kind, i) => ({ kind, id: `link-${i}`, label: 'Current link' })) as Parameters<PersonalTaskStore['create']>[0]['links'],
    source: { kind: 'meeting', id: 'meeting-1', label: 'Meeting' } })
  return store.snapshot()
}
describe('actual personal task JSON import/cache validation', () => {
  test('accepts all current optional metadata/link kinds and round-trips without dropping unknown fields', () => {
    const bundle = fixture(); Object.assign(bundle.tasks[0]!, { reminderDeliveredFor: 3, reminderRetryAt: 4, reminderError: 'presentation-failed', trashedAt: 5, repeatOf: 'old', repeatOccurrenceAt: 6, repeatNextId: 'next', updatedAt: 7, futureMetadata: { preserved: true } })
    const json = JSON.stringify(bundle); const result = PersonalTaskStore.tryFromJson(json)
    expect(result.status).toBe('ok'); if (result.status === 'ok') expect(JSON.parse(result.store.exportJson())).toEqual(bundle)
  })
  test('preserves existing missing-version/missing-collection compatibility and empty valid bundles', () => {
    const bundle = fixture(); const legacy = { tasks: bundle.tasks }
    expect(PersonalTaskStore.tryFromJson(JSON.stringify(legacy)).status).toBe('ok')
    expect(PersonalTaskStore.tryFromJson('{"version":1}').status).toBe('ok')
    expect(PersonalTaskStore.tryFromJson('{"tasks":[]}').status).toBe('ok')
  })
  const badTasks: Array<[string, (task: Record<string, unknown>) => void]> = [
    ['empty id', x => { x.id = '' }], ['blank title', x => { x.title = ' ' }], ['non-string notes', x => { x.notes = {} }],
    ['malformed tag', x => { x.tags = [1] }], ['malformed link', x => { x.links = [null] }], ['unknown link kind', x => { x.links = [{ id: 'x', kind: 'unsupported' }] }],
    ['unknown list', x => { x.list = 'trash' }], ['unknown priority', x => { x.priority = 'urgent' }], ['wrong evening', x => { x.evening = 1 }],
    ['string order', x => { x.order = '0' }], ['wrong creation time', x => { x.createdAt = [] }], ['string date', x => { x.dueAt = 'tomorrow' }],
    ['object relation', x => { x.projectId = {} }], ['malformed recurrence', x => { x.recurrence = { rule: 'weekly', interval: 0 } }],
    ['invalid weekday', x => { x.recurrence = { rule: 'weekly', interval: 1, weekdays: [7] } }], ['invalid repeat mode', x => { x.recurrence = { rule: 'weekly', interval: 1, mode: 'invalid' } }],
    ['malformed checklist', x => { x.checklist = [{ id: 'c', title: 'a', done: 'yes' }] }], ['duplicate checklist id', x => { x.checklist = [{ id: 'c', title: 'a', done: false }, { id: 'c', title: 'b', done: true }] }],
    ['malformed source', x => { x.source = { kind: 'meeting' } }], ['invalid reminder error', x => { x.reminderError = 'unknown' }],
    ['invalid reminder time', x => { x.reminderAt = 'soon' }], ['invalid repeat timestamp', x => { x.repeatOccurrenceAt = {} }],
  ]
  for (const [name, mutate] of badTasks) test(`quarantines ${name} with exact original bytes`, () => {
    const bundle = fixture(); mutate(bundle.tasks[0]! as unknown as Record<string, unknown>); const raw = JSON.stringify(bundle)
    expect(PersonalTaskStore.tryFromJson(raw)).toEqual({ status: 'quarantine', reason: 'invalid-shape', preserved: raw })
  })
  for (const [name, mutate] of [
    ['null task', (b: ReturnType<typeof fixture>) => { b.tasks = [null as never] }],
    ['duplicate task id', (b: ReturnType<typeof fixture>) => { b.tasks.push(structuredClone(b.tasks[0]!)) }],
    ['malformed project', (b: ReturnType<typeof fixture>) => { b.projects[0]!.name = [] as never }],
    ['duplicate project id', (b: ReturnType<typeof fixture>) => { b.projects.push(structuredClone(b.projects[0]!)) }],
    ['malformed area', (b: ReturnType<typeof fixture>) => { b.areas[0]!.order = '0' as never }],
    ['malformed heading', (b: ReturnType<typeof fixture>) => { b.headings[0]!.projectId = {} as never }],
    ['malformed audit', (b: ReturnType<typeof fixture>) => { b.audit[0]!.at = 'yesterday' as never }],
  ] as const) test(`quarantines ${name} before constructing a renderable store`, () => {
    const bundle = fixture(); mutate(bundle); expect(PersonalTaskStore.tryFromJson(JSON.stringify(bundle)).status).toBe('quarantine')
  })
  test('rejects nonfinite JSON numeric overflow without throwing', () => {
    const raw = JSON.stringify(fixture()).replace('"createdAt":2', '"createdAt":1e309')
    expect(PersonalTaskStore.tryFromJson(raw).status).toBe('quarantine')
  })
  test('malformed cache rows preserve canonical raw data, quarantine it and stage later edits separately', () => {
    const raw = '{"version":1,"tasks":[null]}'; const map = new Map([[PERSONAL_TASKS_STORAGE_KEY, raw]])
    const kv = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }
    const loaded = loadPersonalTaskCache(kv); expect(loaded.status).toBe('quarantine'); expect(map.get(PERSONAL_TASKS_QUARANTINE_KEY)).toBe(raw)
    loaded.store.create({ title: 'New safe task' }); expect(persistPersonalTaskCache(kv, loaded.store, loaded.status).wrote).toBe('staging')
    expect(map.get(PERSONAL_TASKS_STORAGE_KEY)).toBe(raw); expect(PersonalTaskStore.tryFromJson(map.get(PERSONAL_TASKS_STAGING_KEY)!).status).toBe('ok')
  })
})
