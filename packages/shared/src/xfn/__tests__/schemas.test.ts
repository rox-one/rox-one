/**
 * W1-15 (#1512) acceptance — zod round-trips and negatives for every X-13…X-26
 * entry point (TECH-SPEC §20).
 *
 * One `safeParse` round-trip plus one rejection per schema, and the two tables
 * the schemas must stay in step with: `XFN_COMMAND_NAMES` (bus commands) and
 * `XFN_QUERY_SCHEMAS` (read models + the UI entry point).
 */
import { describe, expect, it } from 'bun:test'
import { XFN_COMMAND_NAMES, XFN_QUERY_NAMES, XFN_UI_COMMAND_NAMES } from '@rox/core/xfn'
import { XFN_QUERIES } from '../index'
import { XFN_QUERY_SCHEMAS, XFN_SCHEMAS } from '../schemas'

const ISO = '2026-10-08T09:00:00.000Z'
const ref = { kind: 'task', id: 't1' }
const note = { kind: 'note', id: 'n1' }

/** `[schema, valid payload, invalid payload]` for every X-13…X-26 entry point. */
const CASES: Array<[name: string, schema: { safeParse: (value: unknown) => { success: boolean } }, valid: unknown, invalid: unknown]> = [
  ['entities.drop', XFN_SCHEMAS['entities.drop'], { source: [note], target: ref, intent: 'attach' }, { source: [], target: ref }],
  ['entities.pin', XFN_SCHEMAS['entities.pin'], { ref }, {}],
  ['entities.unpin', XFN_SCHEMAS['entities.unpin'], { ref }, { ref: 'task:t1' }],
  ['entities.reorder_pins', XFN_SCHEMAS['entities.reorder_pins'], { refs: [note, ref] }, { refs: [] }],
  ['commands.batch', XFN_SCHEMAS['commands.batch'], { commands: [{ type: 'tasks.create', payload: { title: 'x' } }], label: 'Reassign 3' }, { commands: [], label: '' }],
  ['calendar.create_time_block', XFN_SCHEMAS['calendar.create_time_block'], { taskRef: ref, start: ISO, end: '2026-10-08T10:00:00.000Z' }, { taskRef: ref, start: ISO, end: ISO }],
  [
    'meetings.publish_outcomes',
    XFN_SCHEMAS['meetings.publish_outcomes'],
    { callId: 'c1', decisions: [{ title: 'D' }], tasks: [{ title: 'T' }], summary: 'S' },
    { callId: 'c1', decisions: [], tasks: [], summary: 'S', extra: true },
  ],
  ['reminders.create', XFN_SCHEMAS['reminders.create'], { subjectRef: ref, at: ISO, deliver: ['inbox', 'os'] }, { subjectRef: ref, at: 'tomorrow' }],
  ['reminders.cancel', XFN_SCHEMAS['reminders.cancel'], { id: 'r1' }, { id: '' }],
  ['checkins.draft_from_activity', XFN_SCHEMAS['checkins.draft_from_activity'], { subjectRef: { kind: 'goal', id: 'g1' }, since: ISO }, { subjectRef: { kind: 'goal', id: 'g1' } }],
  ['goals.link_work', XFN_SCHEMAS['goals.link_work'], { goalRef: { kind: 'goal', id: 'g1' }, workRef: ref, relation: 'aligned-to' }, { goalRef: { kind: 'goal', id: 'g1' }, workRef: ref, relation: 'blocks' }],
  ['goals.unlink_work', XFN_SCHEMAS['goals.unlink_work'], { goalRef: { kind: 'project', id: 'p1' }, workRef: ref }, { goalRef: { kind: 'project', id: 'p1' } }],
  ['tasks.create_from_email', XFN_SCHEMAS['tasks.create_from_email'], { messageRef: { kind: 'mail-thread', id: 'm1' }, title: 'T', due: ISO }, { messageRef: { kind: 'mail-thread', id: 'm1' }, title: '' }],
  ['calendar.create_event_from_email', XFN_SCHEMAS['calendar.create_event_from_email'], { messageRef: { kind: 'mail-thread', id: 'm1' }, attendees: 'sender' }, { messageRef: { kind: 'mail-thread', id: 'm1' }, attendees: [] }],
  ['docs.create_from_email', XFN_SCHEMAS['docs.create_from_email'], { messageRef: { kind: 'mail-thread', id: 'm1' }, wholeThread: true }, { messageRef: 'mail-thread:m1' }],
  ['im.share_entity', XFN_SCHEMAS['im.share_entity'], { ref: note, chatRef: { kind: 'channel', id: 'c1' } }, { ref: note, chatRef: { kind: 'channel', id: 'c1' }, comment: 'x'.repeat(2001) }],
  ['forms.configure_on_submit', XFN_SCHEMAS['forms.configure_on_submit'], { formRef: { kind: 'form', id: 'f1' }, actions: [{ kind: 'tasks.create', config: { listRef: 'l1' } }] }, { formRef: { kind: 'form', id: 'f1' }, actions: [{ kind: 'mail.send', config: {} }] }],
  ['vc.start_meeting', XFN_SCHEMAS['vc.start_meeting'], { origin: { kind: 'call', id: 'c1' }, invite: ['p1'] }, { invite: ['p1'] }],
  ['decisions.create', XFN_SCHEMAS['decisions.create'], { title: 'D', body: 'B', originRef: { kind: 'call', id: 'c1' } }, { title: '' }],
  ['tables.insert_row', XFN_SCHEMAS['tables.insert_row'], { baseRef: { kind: 'base', id: 'b1' }, row: { title: 'x' } }, { baseRef: { kind: 'base', id: 'b1' }, row: 'x' }],
  ['people.get_overview', XFN_QUERY_SCHEMAS['people.get_overview'], { personRef: { kind: 'person', id: 'p1' } }, {}],
  ['agenda.today', XFN_QUERY_SCHEMAS['agenda.today'], { date: '2026-10-08', timeZone: 'Europe/Moscow' }, { date: 'not-a-date' }],
  ['agents.panel_open', XFN_QUERY_SCHEMAS['agents.panel_open'], { focusRef: note, prefill: 'Про выделенное: ' }, { focusRef: note, prefill: 'x'.repeat(2001) }],
]

describe('W1-15 X-13…X-26 zod round-trips and negatives', () => {
  for (const [name, schema, valid, invalid] of CASES) {
    it(`${name}: accepts a spec payload and rejects a malformed one`, () => {
      const accepted = schema.safeParse(valid)
      expect({ name, success: accepted.success }).toEqual({ name, success: true })
      const rejected = schema.safeParse(invalid)
      expect({ name, success: rejected.success }).toEqual({ name, success: false })
    })
  }

  it('covers every command schema with a case', () => {
    const covered = new Set(CASES.map(([name]) => name))
    expect(Object.keys(XFN_SCHEMAS).filter((name) => !covered.has(name))).toEqual([])
    expect(Object.keys(XFN_QUERY_SCHEMAS).filter((name) => !covered.has(name))).toEqual([])
  })

  it('has a schema for every command and query the capability table declares', () => {
    const missingCommands = XFN_COMMAND_NAMES.filter((name) => !(name in XFN_SCHEMAS))
    expect(missingCommands).toEqual([])
    const declaredQueries = [...XFN_QUERY_NAMES, ...XFN_UI_COMMAND_NAMES].sort()
    expect(declaredQueries).toEqual(['agenda.today', 'agents.panel_open', 'people.get_overview'])
    // `XFN_QUERIES` is the §20 reading order of the same three entry points.
    expect(declaredQueries).toEqual([...XFN_QUERIES].sort())
    expect(declaredQueries).toEqual(Object.keys(XFN_QUERY_SCHEMAS).sort())
  })

  it('rejects unknown member names everywhere (strict objects)', () => {
    for (const [name, schema, valid] of CASES) {
      const payload = { ...(valid as Record<string, unknown>), smuggled: true }
      expect({ name, success: schema.safeParse(payload).success }).toEqual({ name, success: false })
    }
  })

  it('rejects a non-object payload for every schema', () => {
    for (const [name, schema] of CASES) {
      for (const bad of [null, [], 'x', 3, true]) {
        expect({ name, bad, success: schema.safeParse(bad).success }).toEqual({ name, bad, success: false })
      }
    }
  })

  it('keeps a time block ordered and caps the bulk list', () => {
    const block = XFN_SCHEMAS['calendar.create_time_block']
    expect(block.safeParse({ taskRef: ref, start: '2026-10-08T10:00:00.000Z', end: '2026-10-08T09:00:00.000Z' }).success).toBe(false)
    const batch = XFN_SCHEMAS['commands.batch']
    expect(batch.safeParse({ commands: Array.from({ length: 201 }, () => ({ type: 'tasks.create', payload: {} })), label: 'x' }).success).toBe(false)
    const drop = XFN_SCHEMAS['entities.drop']
    expect(drop.safeParse({ source: Array.from({ length: 51 }, () => note), target: ref }).success).toBe(false)
  })
})