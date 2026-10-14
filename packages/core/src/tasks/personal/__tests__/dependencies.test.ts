import { describe, expect, it } from 'bun:test'
import { PersonalTaskStore } from '../store'

describe('task dependencies', () => {
  it('adds and removes, rejecting self, duplicates and cycles', () => {
    const s = new PersonalTaskStore()
    const a = s.create({ title: 'a' }), b = s.create({ title: 'b' }), c = s.create({ title: 'c' })
    expect(s.addDependency(b.id, a.id)).toBe(true)
    expect(s.addDependency(c.id, b.id)).toBe(true)
    expect(s.addDependency(b.id, a.id)).toBe(false)
    expect(s.addDependency(a.id, a.id)).toBe(false)
    expect(s.addDependency(a.id, c.id)).toBe(false) // a ← b ← c ← a would cycle
    expect(s.get(a.id)!.blockedBy).toBeUndefined()
    expect(s.removeDependency(c.id, b.id)).toBe(true)
    expect(s.get(c.id)!.blockedBy).toBeUndefined()
    expect(s.addDependency(a.id, c.id)).toBe(true)
  })

  it('drops links to removed tasks', () => {
    const s = new PersonalTaskStore()
    const a = s.create({ title: 'a' }), b = s.create({ title: 'b' })
    s.addDependency(b.id, a.id)
    s.remove(a.id)
    expect(s.get(b.id)!.blockedBy).toBeUndefined()
  })
})
