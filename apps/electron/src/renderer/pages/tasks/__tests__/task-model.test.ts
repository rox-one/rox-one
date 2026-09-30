import { describe, expect, it } from 'bun:test'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import {
  agentChipFor,
  agentCounts,
  buildDelegationPrompt,
  parseAgentMention,
  splitEvening,
} from '../task-model'
import { dueReminders } from '../../../lib/task-reminders'

const task = (extra: Partial<PersonalTask> = {}): PersonalTask => ({
  id: 'task-1', title: 'Согласовать макеты', notes: '', list: 'today', tags: [], priority: 'none',
  evening: false, links: [], order: 0, createdAt: 1, ...extra,
})

describe('Задачи view-model', () => {
  it('counts the Агенты selectors from session status', () => {
    const counts = agentCounts([
      { id: 's1', sessionStatus: 'todo' },
      { id: 's2', sessionStatus: 'in-progress', isProcessing: true },
      { id: 's3', sessionStatus: 'needs-review' },
      { id: 's4', sessionStatus: 'done' },
      { id: 's5', sessionStatus: 'needs-review', isArchived: true },
      { id: 's6', taskSlug: 'plan' },
    ])
    expect(counts).toEqual({ board: 3, running: 1, review: 1, conductor: 1 })
  })

  it('derives the agent chip from the latest linked session', () => {
    const sessions = new Map([
      ['s1', { id: 's1', sessionStatus: 'done' }],
      ['s2', { id: 's2', sessionStatus: 'needs-review' }],
    ])
    expect(agentChipFor(task({ links: [{ kind: 'session', id: 's1' }, { kind: 'session', id: 's2' }] }), sessions))
      .toEqual({ sessionId: 's2', chip: 'review' })
    expect(agentChipFor(task({ links: [{ kind: 'session', id: 'gone' }] }), sessions)).toBeNull()
  })

  it('builds the delegation prompt from title, notes and open subtasks', () => {
    const prompt = buildDelegationPrompt(
      task({ notes: 'Показать Марку до вечера.' }),
      [task({ id: 'a', title: 'Инвентаризация' }), task({ id: 'b', title: 'Рендер PNG', completedAt: 5 })],
      'Задача',
    )
    expect(prompt).toBe('Задача: Согласовать макеты\n\nПоказать Марку до вечера.\n\n- [ ] Инвентаризация')
  })

  it('parses «@агент» quick entry and splits the evening group', () => {
    expect(parseAgentMention('Разобрать фидбек @агент')).toEqual({ title: 'Разобрать фидбек', delegate: true })
    expect(parseAgentMention('@agent write docs')).toEqual({ title: 'write docs', delegate: true })
    expect(parseAgentMention('mail@агентство.рф')).toEqual({ title: 'mail@агентство.рф', delegate: false })
    const { day, evening } = splitEvening([task(), task({ id: 'e', evening: true })])
    expect(day.map((t) => t.id)).toEqual(['task-1'])
    expect(evening.map((t) => t.id)).toEqual(['e'])
  })
})
describe('Task reminder eligibility', () => {
  const now = Date.UTC(2026, 8, 30, 12)
  const reminderTask = (extra: Partial<PersonalTask> = {}): PersonalTask => task({
    reminderAt: now - 13 * 60 * 60 * 1000,
    ...extra,
  })

  it('recovers overdue reminders after a long shutdown but never re-presents acknowledged or terminal tasks', () => {
    const due = reminderTask()
    const delivered = reminderTask({ id: 'delivered', reminderDeliveredFor: now - 13 * 60 * 60 * 1000 })
    const completed = reminderTask({ id: 'completed', completedAt: now - 1 })
    expect(dueReminders([due, delivered, completed], now)).toEqual([due])
  })

  it('honors a persisted retry deadline rather than presenting a failed attempt early', () => {
    const failed = reminderTask({ reminderError: 'presentation-failed', reminderRetryAt: now + 1 })
    expect(dueReminders([failed], now)).toEqual([])
    expect(dueReminders([failed], now + 1)).toEqual([failed])
  })
})
