import { describe, expect, test } from 'bun:test'
import { PersonalTaskStore } from '../store.ts'

describe('Cloud union task scheduling uses the caller clock', () => {
  test('an explicitly supplied historical today remains today', () => {
    const now = new Date(2020, 5, 22, 13).getTime()
    const store = new PersonalTaskStore()
    const task = store.create({ title: 'Caller day', now })
    store.setWhen(task.id, { kind: 'date', at: now, evening: true }, now)
    expect(store.get(task.id)?.list).toBe('today')
    expect(store.get(task.id)?.startAt).toBeUndefined()
    expect(store.get(task.id)?.evening).toBe(true)
  })

  test('another caller day remains scheduled while deterministic IDs survive', () => {
    const now = new Date(2020, 5, 22, 13).getTime()
    const later = new Date(2020, 5, 23, 13).getTime()
    const store = new PersonalTaskStore()
    const task = store.create({ id: 'task.union-stable', title: 'Next day', now })
    store.setWhen(task.id, { kind: 'date', at: later }, now)
    expect(store.get(task.id)?.list).toBe('upcoming')
    expect(store.get(task.id)?.id).toBe('task.union-stable')
    expect(store.get(task.id)?.startAt).toBe(new Date(2020, 5, 23).getTime())
  })
})
