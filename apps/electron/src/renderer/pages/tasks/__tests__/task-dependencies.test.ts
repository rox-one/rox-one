import { describe, expect, it } from 'bun:test'
import { PersonalTaskStore } from '@rox/core/tasks/personal'
import { dependencyCandidates } from '../TaskDependencies'

describe('dependencyCandidates', () => {
  it('excludes self, existing links, cycles and closed tasks', () => {
    const s = new PersonalTaskStore()
    const a = s.create({ title: 'a' }), b = s.create({ title: 'b' }), c = s.create({ title: 'c' }), done = s.create({ title: 'done' })
    s.completeTask(done.id)
    s.addDependency(b.id, a.id)
    s.addDependency(c.id, b.id)
    expect(dependencyCandidates(s, s.get(a.id)!).map((x) => x.title)).toEqual([])
    expect(dependencyCandidates(s, s.get(b.id)!).map((x) => x.title)).toEqual([])
    expect(dependencyCandidates(s, s.get(c.id)!).map((x) => x.title)).toEqual(['a'])
  })
})
