/**
 * Review 3 #6: `add` bumps the revision atomically in one upsert statement
 * (`ON CONFLICT … revision = entity_links.revision + 1 RETURNING *`).
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EntityLinkStore } from '../link-store.ts'

describe('atomic revision upsert (review 3 #6)', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('creates at revision 1 and increments on every re-add, keeping id and createdAt', () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-link-rev-'))
    roots.push(root)
    const store = new EntityLinkStore({ workspaceRoot: root })
    const input = { from: { kind: 'note' as const, id: 'n1' }, to: { kind: 'task' as const, id: 't1' }, relation: 'mentions' as const, createdBy: 'u' }
    const first = store.add(input)
    expect(first.revision).toBe(1)
    const second = store.add({ ...input, anchor: { line: 3 } })
    const third = store.add(input)
    expect(second.revision).toBe(2)
    expect(third.revision).toBe(3)
    expect(third.linkId).toBe(first.linkId)
    expect(third.createdAt).toBe(first.createdAt)
    expect(second.anchor).toEqual({ line: 3 })
    expect(store.count()).toBe(1)
    store.close()
  })

  it('two connections on the same DB never write the same revision twice', () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-link-rev2-'))
    roots.push(root)
    const a = new EntityLinkStore({ workspaceRoot: root })
    const b = new EntityLinkStore({ workspaceRoot: root })
    const input = { from: { kind: 'note' as const, id: 'n1' }, to: { kind: 'task' as const, id: 't1' }, relation: 'mentions' as const, createdBy: 'u' }
    const revisions = [a.add(input), b.add(input), a.add(input), b.add(input)].map(link => link.revision)
    expect(revisions).toEqual([1, 2, 3, 4])
    a.close()
    b.close()
  })
})
