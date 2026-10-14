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
