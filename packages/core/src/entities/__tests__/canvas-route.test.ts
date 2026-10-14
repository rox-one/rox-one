import { describe, expect, it } from 'bun:test'
import { parseEntityRoute } from '../parse-route.ts'
import { entityRoute } from '../routes.ts'

describe('canvas entity route', () => {
  it('parses canvas/board/{id}', () => {
    const p = parseEntityRoute('canvas/board/b1')
    expect(p?.ref.kind).toBe('canvas')
    expect(p?.ref.id).toBe('b1')
  })
  it('parses the #objectId fragment', () => {
    const p = parseEntityRoute('canvas/board/b1#obj-9')
    expect(p?.ref.id).toBe('b1')
    expect(p?.ref.fragment).toBe('obj-9')
  })
  it('round-trips through entityRoute', () => {
    const p = parseEntityRoute('canvas/board/b1#obj-9')!
    expect(parseEntityRoute(entityRoute(p.ref))?.ref.fragment).toBe('obj-9')
  })
})
