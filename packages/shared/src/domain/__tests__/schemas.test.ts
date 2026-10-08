import { describe, expect, test } from 'bun:test'
import { COMMAND_CATALOGUE } from '@rox/core/commands'
import { COMMAND_PAYLOAD_SCHEMAS, DOMAIN_COMMAND_SCHEMA_MODULES, ENTITY_SCHEMAS, noteFrontmatterSchema } from '../index'

const catalogue = COMMAND_CATALOGUE.map(definition => definition.type).filter(type => !type.startsWith('system.')).sort()

describe('domain command schemas (W1-06)', () => {
  test('cover exactly the non-system catalogue', () => {
    expect(Object.keys(COMMAND_PAYLOAD_SCHEMAS).sort()).toEqual(catalogue)
  })

  test('module maps do not overlap', () => {
    const counts = new Map<string, number>()
    for (const map of Object.values(DOMAIN_COMMAND_SCHEMA_MODULES)) for (const type of Object.keys(map)) counts.set(type, (counts.get(type) ?? 0) + 1)
    expect([...counts].filter(([, count]) => count > 1)).toEqual([])
  })

  test.each(catalogue)('%s rejects unknown members and non-objects', type => {
    const schema = COMMAND_PAYLOAD_SCHEMAS[type]!
    expect(schema.safeParse({ __unknown: 1 }).success).toBe(false)
    expect(schema.safeParse(null).success).toBe(false)
    expect(schema.safeParse([]).success).toBe(false)
  })

  test.each([
    ['tasks.create', { title: 'Write spec', priority: 'urgent', dueAt: '2026-10-09T10:00:00+03:00' }],
    ['tasks.update_status', { statusKey: 'in_progress' }],
    ['task_statuses.update_set', { statuses: [{ key: 'todo', label: 'tasks.status.todo', color: 'gray', closed: false, kind: 'open' }] }],
    ['goals.create', { name: 'Grow', targets: [{ name: 'MAU', fromValue: 0, toValue: 100 }] }],
    ['goals.update_target', { targetId: 't1', value: 4 }],
    ['okr.create_cycle', { name: 'Q4', startsOn: '2026-10-01', endsOn: '2026-12-31' }],
    ['milestones.create', { projectId: 'p1', title: 'Beta' }],
    ['kpis.log_entry', { value: 3.5, period: '2026-10-01' }],
    ['calendar.create_event', { title: 'Sync', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', tz: 'UTC' }],
    ['links.add', { to: { kind: 'goal', id: 'g1' }, relation: 'aligned-to' }],
    ['im.send_message', { body: { doc: 'hi' }, mentions: ['u1'] }],
    ['drive.complete_upload', { uploadSessionId: 'u1', sha256: 'a'.repeat(64) }],
    ['acl.grant', { principal: { kind: 'user', id: 'u2' }, role: 'editor' }],
    ['commands.batch', { commands: [{ type: 'tasks.complete', target: { kind: 'task', id: 't1' }, payload: {} }] }],
  ])('%s accepts a valid payload', (type, payload) => {
    const parsed = COMMAND_PAYLOAD_SCHEMAS[type]!.safeParse(payload)
    expect(parsed.error).toBeUndefined()
    expect(parsed.success).toBe(true)
  })

  test.each([
    ['tasks.update', {}, 'empty update'],
    ['goals.update_target', { targetId: 't1' }, 'empty update'],
    ['okr.create_cycle', { name: 'Q4', startsOn: '2026-12-31', endsOn: '2026-10-01' }, 'ends before'],
    ['calendar.create_event', { title: 'x', start: '2026-10-09T11:00:00Z', end: '2026-10-09T10:00:00Z', tz: 'UTC' }, 'precede'],
    ['tasks.add_dependency', { blocks: 'a', blockedBy: 'b' }, 'exactly one'],
    ['task_statuses.update_set', { statuses: [{ key: 'a', label: 'l', color: 'gray', closed: false, kind: 'open' }, { key: 'a', label: 'l', color: 'blue', closed: true, kind: 'done' }] }, 'duplicate'],
    ['links.add', { to: { kind: 'nope', id: 'x' }, relation: 'aligned-to' }, 'kind'],
    ['acl.grant', { principal: { kind: 'user', id: 'u' }, role: 'owner' }, ''],
    ['tasks.create', { title: '   ' }, ''],
    ['drive.complete_upload', { uploadSessionId: 'u', sha256: 'xyz' }, ''],
  ])('%s rejects %j', (type, payload, message) => {
    const parsed = COMMAND_PAYLOAD_SCHEMAS[type]!.safeParse(payload)
    expect(parsed.success).toBe(false)
    if (message) expect(JSON.stringify(parsed.error?.issues)).toContain(message)
  })

  test('entity schemas parse stored records', () => {
    const goal = ENTITY_SCHEMAS.goal.safeParse({ id: 'g1', revision: 1, authority: 'local', scope: 'company', goalKind: 'goal', name: 'Grow', creatorId: 'local', publishState: 'published' })
    expect(goal.success).toBe(true)
    expect(ENTITY_SCHEMAS.goal.safeParse({ id: 'g1', revision: -1, authority: 'local' }).success).toBe(false)
  })

  test('frontmatter schema accepts rox_authority and keeps other keys', () => {
    expect(noteFrontmatterSchema.parse({ rox_authority: 'workspace', title: 'x' })).toEqual({ rox_authority: 'workspace', title: 'x' })
    expect(noteFrontmatterSchema.safeParse({ rox_authority: 'cloud' }).success).toBe(false)
  })
})
