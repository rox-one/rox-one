import { describe, expect, it } from 'bun:test'
import { pickRetainedEmbeddedId, planRetainedBrowserOpen } from '../retained-pane.ts'

describe('retained embedded browser (Issue 14)', () => {
  it('reuses the first embedded pane instead of creating another', () => {
    const plan = planRetainedBrowserOpen(
      [
        { id: 'os-1' },
        { id: 'embedded-1', embedded: true },
        { id: 'embedded-2', embedded: true },
      ],
      'https://example.com',
    )
    expect(plan).toEqual({ action: 'navigate', id: 'embedded-1', url: 'https://example.com' })
    expect(pickRetainedEmbeddedId([{ id: 'os-1' }])).toBeNull()
  })

  it('creates when no embedded pane is retained', () => {
    expect(planRetainedBrowserOpen([{ id: 'os-1' }], 'https://docs.rox')).toEqual({
      action: 'create',
      url: 'https://docs.rox',
    })
  })
})
