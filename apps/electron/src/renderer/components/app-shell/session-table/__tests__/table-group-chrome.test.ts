import { describe, expect, it } from 'bun:test'
import { collapsibleTableGroupKeys, selectTableGroupSessionIds } from '../table-group-chrome'

const groups = [
  { bucket: { key: 'status:todo', label: 'Todo', count: 2 }, items: [{ id: 'a' }, { id: 'b' }] },
  { bucket: { key: 'status:done', label: 'Done', count: 0 }, items: [] as Array<{ id: string }> },
]

describe('table group chrome', () => {
  it('selects every session in a group even when the bucket is empty elsewhere', () => {
    expect(selectTableGroupSessionIds(groups, 'status:todo')).toEqual(['a', 'b'])
    expect(selectTableGroupSessionIds(groups, 'status:done')).toEqual([])
    expect(selectTableGroupSessionIds(groups, 'status:missing')).toEqual([])
  })

  it('collapse-all targets only populated buckets', () => {
    expect(collapsibleTableGroupKeys(groups)).toEqual(['status:todo'])
  })
})
