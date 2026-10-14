import { describe, expect, it } from 'bun:test'
import { PersonalTaskStore } from '@rox/core/tasks/personal'
import { insertHeading, isHeadingDrop } from '../magic-plus'

describe('Magic Plus heading drop', () => {
  it('detects the left gutter', () => {
    expect(isHeadingDrop(110, 100)).toBe(true)
    expect(isHeadingDrop(200, 100)).toBe(false)
  })

  it('inserts a heading after the section and moves the following rows under it', () => {
    const store = new PersonalTaskStore()
    const project = store.addProject('P')
    const h1 = store.addHeading('A', project.id)
    const h2 = store.addHeading('B', project.id)
    const a = store.create({ title: 'a', projectId: project.id, headingId: h1.id })
    const b = store.create({ title: 'b', projectId: project.id, headingId: h1.id })
    const heading = insertHeading(store, project.id, 'New', h1.id, [b.id])
    expect(store.headings(project.id).map((h) => h.id)).toEqual([h1.id, heading.id, h2.id])
    expect(store.get(b.id)!.headingId).toBe(heading.id)
    expect(store.get(a.id)!.headingId).toBe(h1.id)
  })

  it('inserts before every heading from the unheaded section', () => {
    const store = new PersonalTaskStore()
    const project = store.addProject('P')
    const h1 = store.addHeading('A', project.id)
    const heading = insertHeading(store, project.id, 'New', null, [])
    expect(store.headings(project.id).map((h) => h.id)).toEqual([heading.id, h1.id])
  })
})

import { acceptsPlusDrop, destDefaults, navDropKind } from '../magic-plus'

describe('Magic Plus heading insert details', () => {
  it('a stale afterHeadingId appends instead of going first', () => {
    const store = new PersonalTaskStore()
    const project = store.addProject('P')
    const h1 = store.addHeading('A', project.id)
    const heading = insertHeading(store, project.id, 'New', 'gone', [])
    expect(store.headings(project.id).map((h) => h.id)).toEqual([h1.id, heading.id])
  })

  it('keeps moved tasks in order and subtasks follow their parent', () => {
    const store = new PersonalTaskStore()
    const project = store.addProject('P')
    const a = store.create({ title: 'a', projectId: project.id, list: 'anytime' })
    const b = store.create({ title: 'b', projectId: project.id, list: 'anytime' })
    const child = store.create({ title: 'c', projectId: project.id, parentId: a.id })
    const before = [store.get(a.id)!.order, store.get(b.id)!.order]
    const heading = insertHeading(store, project.id, 'New', null, [a.id, b.id])
    expect([store.get(a.id)!.order, store.get(b.id)!.order]).toEqual(before)
    expect(store.get(child.id)!.headingId).toBe(heading.id)
  })
})

describe('Magic Plus sidebar drop', () => {
  const PLUS = 'text/x-rox-magic-plus'
  const TASK = 'text/x-rox-task'
  it('ignores + on trash and logbook', () => {
    expect(acceptsPlusDrop('trash')).toBe(false)
    expect(acceptsPlusDrop('logbook')).toBe(false)
    expect(navDropKind([PLUS], 'trash', PLUS, TASK)).toBeNull()
    expect(navDropKind([PLUS], 'logbook', PLUS, TASK)).toBeNull()
    expect(destDefaults('trash', 0)).toBeNull()
  })
  it('tells a + drop from a task drag', () => {
    expect(navDropKind([PLUS], 'project:p', PLUS, TASK)).toBe('plus')
    expect(navDropKind([TASK], 'project:p', PLUS, TASK)).toBe('task')
    expect(navDropKind([TASK], 'trash', PLUS, TASK)).toBe('task')
    expect(navDropKind(['text/plain'], 'project:p', PLUS, TASK)).toBeNull()
  })
  it('derives creation defaults from the destination', () => {
    expect(destDefaults('heading:p:h', 5)).toEqual({ list: 'anytime', projectId: 'p', headingId: 'h' })
    expect(destDefaults('when:evening', 5)).toEqual({ list: 'today', when: { kind: 'evening' } })
    expect(destDefaults('when:upcoming', 5)).toEqual({ list: 'upcoming', when: { kind: 'date', at: 5 } })
    expect(destDefaults('area:x', 5)).toEqual({ list: 'anytime', areaId: 'x' })
  })
})
