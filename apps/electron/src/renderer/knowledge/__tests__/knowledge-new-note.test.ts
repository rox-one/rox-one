import { describe, expect, it } from 'bun:test'
import { buildNewDocumentCreateArgs, pickOpenNotebook } from '../knowledge-new-note'

describe('pickOpenNotebook', () => {
  it('prefers the first not-closed notebook', () => {
    const picked = pickOpenNotebook([
      { id: 'closed-first', closed: true },
      { id: 'open-a', closed: false },
      { id: 'open-b', closed: false },
    ])
    expect(picked?.id).toBe('open-a')
  })

  it('falls back to the first notebook when all are closed', () => {
    const picked = pickOpenNotebook([
      { id: 'a', closed: true },
      { id: 'b', closed: true },
    ])
    expect(picked?.id).toBe('a')
  })

  it('treats missing closed as open', () => {
    expect(pickOpenNotebook([{ id: 'implicit-open' }])?.id).toBe('implicit-open')
  })

  it('returns undefined for an empty list', () => {
    expect(pickOpenNotebook([])).toBeUndefined()
  })
})

describe('buildNewDocumentCreateArgs', () => {
  it('builds navigator document create args', () => {
    expect(
      buildNewDocumentCreateArgs({
        connectionId: 'conn-1',
        notebookId: 'nb-9',
        title: 'Untitled',
      }),
    ).toEqual({
      connectionId: 'conn-1',
      source: 'navigator',
      op: 'document',
      notebookId: 'nb-9',
      title: 'Untitled',
    })
  })
})
