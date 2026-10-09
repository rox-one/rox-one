/**
 * W1-09 (#1506) — the activity renderer registry: modules register a renderer
 * per event type, and the Feed / Inbox resolve one by the item's type.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import type { ActivityItem } from '@rox/core/notify'
import {
  __resetActivityRenderersForTests,
  activityRendererFor,
  hasActivityRenderer,
  listActivityRenderers,
  registerActivityRenderer,
} from '../registry'

afterEach(() => { __resetActivityRenderersForTests() })

function Card() { return null }
function Detail() { return null }

const item: ActivityItem = {
  id: 'event-1',
  type: 'goals.goal_check_in',
  module: 'goals',
  refs: [{ kind: 'goal', id: 'goal-1' }],
  revision: 3,
  at: '2026-10-08T10:00:00.000Z',
}

describe('activity renderer registry', () => {
  it('registers nothing by default and resolves nothing', () => {
    expect(listActivityRenderers()).toEqual([])
    expect(activityRendererFor('goals.goal_check_in')).toBeUndefined()
    expect(hasActivityRenderer('goals.goal_check_in')).toBe(false)
  })

  it('resolves an exact event type before the module fallback', () => {
    registerActivityRenderer({ id: 'goals', module: 'goals', renderer: Card })
    registerActivityRenderer({ id: 'goals-check-in', module: 'goals', eventTypes: ['goals.goal_check_in'], renderer: Detail })
    expect(activityRendererFor(item.type)?.renderer).toBe(Detail)
    expect(activityRendererFor('goals.goal_closing')?.renderer).toBe(Card)
    expect(hasActivityRenderer('goals.goal_closing')).toBe(true)
  })

  it('rejects a duplicate registration for one event type or module', () => {
    registerActivityRenderer({ id: 'tasks', module: 'task', renderer: Card })
    expect(() => registerActivityRenderer({ id: 'tasks-2', module: 'task', renderer: Card })).toThrow(/already registered/)
    registerActivityRenderer({ id: 'docs', module: 'docs', eventTypes: ['docs.document_edited'], renderer: Card })
    expect(() => registerActivityRenderer({ id: 'docs-2', module: 'docs', eventTypes: ['docs.document_edited'], renderer: Card })).toThrow(/already registered/)
    expect(() => registerActivityRenderer({ id: '', module: 'x', renderer: Card })).toThrow(/need an id and a module/)
  })

  it('leaves events without a renderer unresolved, so the Feed falls back', () => {
    registerActivityRenderer({ id: 'goals', module: 'goals', renderer: Card })
    expect(activityRendererFor('im.message.receive_v1')).toBeUndefined()
  })
})