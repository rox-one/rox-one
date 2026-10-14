import { describe, expect, it } from 'bun:test'
import { sessionMenu } from '../sessions-sidebar-sections'

describe('session row menu', () => {
  it('offers share when private, copy/stop when shared, always open-side', () => {
    expect(sessionMenu({}).map((m) => m.id)).toEqual(['open-side', 'share'])
    expect(sessionMenu({ sharedUrl: 'https://v/s/x' }).map((m) => m.id)).toEqual(['open-side', 'copy-link', 'stop-sharing'])
  })
})
